import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, 'code.html');
const sourceUrl = pathToFileURL(sourcePath).href;
const serverPath = path.resolve(here, 'aura-server.mjs');
const fakePath = path.resolve(here, 'test-support/fake-upstream.mjs');
const source = fs.readFileSync(sourcePath, 'utf8');
const scriptMatches = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];

for (const [index, match] of scriptMatches.entries()) {
  new vm.Script(match[1], { filename: `code-inline-${index}.js` });
}

const ids = [...source.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicateIds.length) throw new Error(`Duplicate HTML ids: ${duplicateIds.join(', ')}`);
if (/\b(innerHTML|localStorage|sessionStorage)\b/.test(source)) throw new Error('Unsafe user-content or persistence API found');

// A pasted key must never be committable. The page holds no secret, so the literal header name has no
// business being in it either; the bridge is the only component allowed to set Authorization, and it
// reads the value from the environment.
if (/authorization\s*:/i.test(source)) throw new Error('code.html must not build an Authorization header; the bridge owns credentials');
const keyPattern = /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/;
for (const file of [sourcePath, serverPath, fakePath]) {
  const hit = keyPattern.exec(fs.readFileSync(file, 'utf8'));
  if (hit) throw new Error(`Possible API key committed in ${path.basename(file)}: ${hit[0].slice(0, 6)}…`);
}
for (const file of [serverPath, fakePath]) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${path.relative(here, file)}`);
  // These are ES modules, so vm.Script cannot parse them; node --check can.
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error(`${path.basename(file)} does not parse: ${(check.stderr || '').trim()}`);
}

console.log(`Static checks passed: ${scriptMatches.length} scripts, ${ids.length} unique ids, no secrets, no persistence API`);

const browserRequired = process.argv.includes('--browser') || process.env.AURA_BROWSER === '1';
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (error) {
  if (browserRequired) throw new Error('Playwright is required for --browser');
  console.log('Browser checks skipped: Playwright is not available; rerun with --browser after installing it.');
  process.exit(0);
}

const assert = (value, message) => {
  if (!value) throw new Error(message);
};

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.on('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

const waitForHttp = async (url, label, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  let detail = 'never attempted';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json().catch(() => ({}));
      detail = `HTTP ${response.status}`;
    } catch (error) {
      detail = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} never became ready (${detail})`);
};

const startChild = (label, scriptPath, env) => {
  const child = spawn(process.execPath, [scriptPath], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = [];
  const collect = (chunk) => {
    log.push(String(chunk));
    if (log.length > 80) log.shift();
  };
  child.stdout.setEncoding('utf8').on('data', collect);
  child.stderr.setEncoding('utf8').on('data', collect);
  child.on('error', (error) => collect(`spawn error: ${error.message}`));
  return { label, child, log };
};

const stopChild = async (handle) => {
  if (!handle || handle.child.exitCode !== null) return;
  handle.child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => { handle.child.kill('SIGKILL'); resolve(); }, 3000);
    handle.child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
};

const fakePort = await freePort();
const bridgePort = await freePort();
const control = `http://127.0.0.1:${fakePort}/__control`;
const appUrl = `http://127.0.0.1:${bridgePort}/`;

const fake = startChild('fake-upstream', fakePath, { FAKE_HOST: '127.0.0.1', FAKE_PORT: String(fakePort) });
const bridge = startChild('aura-server', serverPath, {
  AURA_HOST: '127.0.0.1',
  AURA_PORT: String(bridgePort),
  OPENAI_API_KEY: 'test-key-not-a-real-secret',
  OPENAI_BASE_URL: `http://127.0.0.1:${fakePort}/v1`,
  OPENAI_MODEL: 'fake-chat-1',
  OLLAMA_URL: `http://127.0.0.1:${fakePort}`,
  OLLAMA_MODEL: 'fake-llama-chat',
  AURA_MCP_URL: `http://127.0.0.1:${fakePort}/mcp`,
  AURA_MCP_SITE: 'aura-test.localhost',
  FRAPPE_API_KEY: 'test-api-key',
  FRAPPE_API_SECRET: 'test-api-secret',
  AURA_FISCAL_YEAR_START_MONTH: '4'
});

const controlGet = async (route) => {
  const response = await fetch(`${control}/${route}`);
  const body = await response.json();
  return body;
};
const setScenario = (scenario, extra = {}) =>
  fetch(`${control}/scenario`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario, ...extra }) });
const resetFake = () => fetch(`${control}/reset`, { method: 'POST' });
const upstreamRequests = async () => (await controlGet('requests')).requests || [];
const upstreamCalls = async () => (await controlGet('calls')).calls || [];
const inFlight = async () => (await controlGet('connections')).inFlight;

// Chromium logs a console error for every non-2xx response, whether or not the page did anything wrong.
// Those are tracked separately so a deliberate error-path group cannot mask - or be masked by - a real bug.
const NETWORK_NOISE = 'Failed to load resource';
const attachErrors = (target) => {
  const pageErrors = [];
  const consoleErrors = [];
  target.on('pageerror', (error) => pageErrors.push(`pageerror: ${error.message}`));
  target.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (message.text().includes(NETWORK_NOISE)) return;
    consoleErrors.push(`console: ${message.text()}`);
  });
  return { pageErrors, consoleErrors };
};
const assertClean = (errors, label) => {
  assert(errors.pageErrors.length === 0, `${label} threw: ${errors.pageErrors.join('; ')}`);
  assert(errors.consoleErrors.length === 0, `${label} logged: ${errors.consoleErrors.join('; ')}`);
};

const sendPrompt = async (page, text) => {
  if (await page.locator('#chat-input').isVisible().catch(() => false)) {
    await page.fill('#chat-input', text);
    await page.click('#chat-send-btn');
    return;
  }
  await page.fill('#prompt-input', text);
  await page.click('[data-action="send-prompt"]');
};

const idle = (page, timeout = 60000) => page.waitForFunction(() => window.aura && !window.aura.state.busy, null, { timeout });

// The fake decides turn-versus-final by counting role:'tool' messages in the request, so a scenario is
// consumed once per conversation. Every group that scripts a turn starts from an empty transcript.
const freshChat = async (page) => {
  await idle(page);
  await page.locator('[data-action="new-chat"]:visible').first().click();
  await page.waitForFunction(() => window.aura.state.messages.length === 0, null, { timeout: 10000 });
};

const waitForMcp = (page, timeout = 25000) =>
  page.waitForFunction(() => window.aura && window.aura.state.mcp.status === 'ready', null, { timeout });

let browser;
try {
  await waitForHttp(`${control}/connections`, 'fake upstream');
  const catalog = await controlGet('tools');
  await waitForHttp(`${appUrl}api/health`, 'aura bridge');
  const config = await (await fetch(`${appUrl}api/config`)).json();
  const health = await (await fetch(`${appUrl}api/health`)).json();

  browser = await chromium.launch({
    headless: true,
    ...(process.env.AURA_CHROMIUM_PATH ? { executablePath: process.env.AURA_CHROMIUM_PATH } : {})
  });
  const desktop = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  const errors = attachErrors(desktop);

  // ------------------------------------------------------------------ 1. degraded file:// page
  {
    const offline = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const offlineErrors = attachErrors(offline);
    const attempted = [];
    offline.on('request', (request) => {
      if (/\/api\/|\/proxy\//.test(new URL(request.url()).pathname)) attempted.push(request.url());
    });
    await offline.goto(sourceUrl);
    await offline.waitForFunction(() => window.aura && window.aura.state.bridgeCheck !== 'idle', null, { timeout: 10000 });
    assert(attempted.length === 0, `file:// page must issue no bridge request, saw ${attempted.join(', ')}`);
    assert(await offline.evaluate(() => window.aura.state.activeProvider) === 'demo', 'file:// must fall back to the demo provider');
    assert(await offline.locator('#aura-banner, #dashboard-banner').first().isVisible(), 'offline banner is missing');
    const degraded = await offline.evaluate(() => Object.fromEntries(window.aura.providers.map((provider) => [provider.id, { configured: provider.configured, envHint: provider.envHint }])));
    assert(Object.keys(degraded).length === 3, `the degraded page should still list every provider, got ${Object.keys(degraded).join(', ')}`);
    assert(degraded.openai.envHint.includes('OPENAI_API_KEY'), 'the degraded page must name OPENAI_API_KEY even with no bridge to ask');
    assert(degraded.ollama.envHint.includes('OLLAMA_URL'), 'the degraded page must name OLLAMA_URL even with no bridge to ask');
    assert(degraded.openai.configured === false, 'a provider with no bridge must not claim to be configured');
    await offline.locator('[data-action="nav-settings"]').click();
    assert((await offline.locator('#settings-provider-list').textContent()).includes('OPENAI_API_KEY'), 'degraded settings must name OPENAI_API_KEY');
    assert(await offline.locator('.settings-model-option').count() === 1, 'degraded page must offer exactly the demo model');
    assertClean(offlineErrors, 'file:// degraded page');
    await offline.close();
  }

  // ------------------------------------------------------------------ 2. boot over HTTP
  await desktop.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await desktop.waitForFunction(() => window.aura && window.aura.providers.some((provider) => provider.id === 'openai' && provider.status === 'ready'), null, { timeout: 25000 });
  await waitForMcp(desktop);

  assert(health.providers.openai.reachable === true, 'bridge reports OpenAI unreachable against the fake');
  assert(health.providers.ollama.reachable === true, 'bridge reports Ollama unreachable against the fake');
  assert(health.mcp.reachable === true, 'bridge reports MCP unreachable against the fake');
  assert(health.providers.openai.chatModels.every((id) => !/embed/i.test(id)), `bridge leaked an embedding model: ${health.providers.openai.chatModels.join(', ')}`);
  assert(health.providers.ollama.chatModels.length >= 1, 'bridge found no Ollama chat models');
  assert(!JSON.stringify(config).includes('test-key-not-a-real-secret') && !JSON.stringify(config).includes('test-api-secret'), 'the bridge echoed a key through /api/config');
  assert(config.fiscalYear?.label && config.fiscalYear?.startDate, 'the bridge did not compute a fiscal year');
  const runtimeConfig = await desktop.evaluate(() => {
    const byId = Object.fromEntries(window.aura.providers.map((provider) => [provider.id, provider]));
    return {
      openaiModels: byId.openai.models,
      ollamaModels: byId.ollama.models,
      active: window.aura.state.activeProvider,
      activeModel: byId.openai.modelId
    };
  });
  assert(runtimeConfig.openaiModels.includes('fake-chat-1'), `fake OpenAI model not discovered: ${runtimeConfig.openaiModels.join(', ')}`);
  assert(!runtimeConfig.openaiModels.some((id) => /embed/i.test(id)), 'page leaked an embedding model into the menu');
  assert(runtimeConfig.active === 'openai', `expected the bridge to auto-select openai, got ${runtimeConfig.active}`);
  assert(runtimeConfig.activeModel === 'fake-chat-1', `active model should be the discovered id, got ${runtimeConfig.activeModel}`);
  assert(!/offline preview/i.test(await desktop.locator('#dashboard-banner').textContent()), 'no offline banner is expected when the bridge is up');

  // ------------------------------------------------------------------ 3. staging, camera, search, commands
  assert(await desktop.locator('.staged-file').count() === 3, 'default staged files are missing');
  assert(await desktop.locator('#staging-composer-card').getAttribute('data-state') === 'ready', 'initial staging state is not ready');
  assert(await desktop.locator('#staging-onboarding').isHidden(), 'onboarding should be hidden with files');
  assert(await desktop.locator('.session-row').count() === 6, 'seeded session history is incomplete');
  await desktop.locator('#session-filter').fill('FastAPI');
  assert(await desktop.locator('[data-session-row]:visible').count() === 1, 'session filter did not narrow history');
  assert(await desktop.locator('#session-empty').isHidden(), 'session empty state appeared for a matching filter');
  await desktop.locator('#session-filter').fill('');
  await desktop.locator('[data-session-id="pinned-roadmap"]').click();
  assert(await desktop.locator('#chat-view').isVisible(), 'seeded session did not open chat');
  assert(await desktop.locator('.message-row').count() === 2, 'seeded session transcript is incomplete');
  await desktop.locator('.chat-new-button').click();
  assert(await desktop.locator('#dashboard-view').isVisible(), 'New Chat did not clear the seeded session');

  await desktop.locator('[data-action="open-camera"]').click();
  assert(await desktop.locator('#camera-modal').isVisible(), 'camera drawer did not open');
  assert(await desktop.locator('.camera-dialog').getAttribute('data-camera-state') === 'ready', 'camera initial state is not ready');
  await desktop.locator('#camera-primary').click();
  assert(await desktop.locator('.camera-dialog').getAttribute('data-camera-state') === 'analyzing', 'camera analyzing state missing');
  await desktop.waitForFunction(() => document.querySelector('.camera-dialog')?.dataset.cameraState === 'success', null, { timeout: 4000 });
  await desktop.locator('[data-action="camera-error"]').click();
  assert(await desktop.locator('.camera-dialog').getAttribute('data-camera-state') === 'error', 'camera error state missing');
  await desktop.keyboard.press('Escape');
  assert(await desktop.locator('#camera-modal').isHidden(), 'camera drawer did not close');

  await desktop.keyboard.press('Control+KeyK');
  assert(await desktop.locator('#search-modal').isVisible(), 'global search did not open');
  await desktop.locator('#search-modal-input').fill('kubernetes');
  assert(await desktop.locator('.search-result').count() === 1, 'global search filtering failed');
  await desktop.keyboard.press('Enter');
  assert((await desktop.locator('#prompt-input').inputValue()).includes('deployment configuration'), 'search result was not inserted');
  await desktop.locator('#prompt-input').fill('/');
  assert(await desktop.locator('#command-menu').isVisible(), 'slash command menu did not open');
  await desktop.keyboard.press('Enter');
  assert(await desktop.locator('#command-menu').isHidden(), 'slash command menu did not close');

  while (await desktop.locator('.staged-file-remove').count()) {
    await desktop.locator('.staged-file-remove').first().click();
    await desktop.waitForTimeout(30);
  }
  assert(await desktop.locator('#staging-composer-card').getAttribute('data-state') === 'empty', 'empty staging state is missing');
  await desktop.locator('#staged-file-input').setInputFiles({ name: 'validation.json', mimeType: 'application/json', buffer: Buffer.from('{"ok":true}') });
  await desktop.waitForFunction(() => document.querySelector('#staging-composer-card')?.dataset.state === 'success', null, { timeout: 4000 });
  const dataTransfer = await desktop.evaluateHandle(() => new DataTransfer());
  await dataTransfer.evaluate((transfer) => transfer.items.add(new File(['drag content'], 'drag.md', { type: 'text/markdown' })));
  await desktop.locator('#staged-drop-zone').dispatchEvent('dragenter', { dataTransfer });
  await desktop.locator('#staged-drop-zone').dispatchEvent('drop', { dataTransfer });
  await desktop.waitForFunction(() => [...document.querySelectorAll('.staged-file-name')].some((node) => node.textContent === 'drag.md'), null, { timeout: 4000 });

  // ------------------------------------------------------------------ 4. settings: models, providers, tab trap
  await desktop.locator('[data-action="nav-settings"]').click();
  assert(await desktop.locator('#settings-modal').isVisible(), 'settings drawer did not open');
  const discovered = await desktop.locator('.settings-model-option').first().getAttribute('data-model');
  assert(discovered === 'fake-chat-1', `settings model list should be built from discovery, got ${discovered}`);
  await desktop.locator('.settings-model-option').first().click();
  assert((await desktop.locator('[data-model-label]').first().textContent()).includes('fake-chat-1'), 'settings model did not synchronize to the discovered id');
  const providerIds = await desktop.locator('.settings-provider-select').evaluateAll((nodes) => nodes.map((node) => node.dataset.provider));
  assert(JSON.stringify(providerIds) === JSON.stringify(['openai', 'ollama', 'demo']), `providers section should list the catalog in order, got ${providerIds.join(', ')}`);
  const providerText = await desktop.locator('#settings-provider-list').textContent();
  assert(providerText.includes('127.0.0.1'), 'providers section does not show the upstream host');
  assert(/model/i.test(providerText), `providers section should report discovered model counts, got "${providerText}"`);
  const activeRow = await desktop.locator('.settings-provider-row.is-active .settings-provider-select').getAttribute('data-provider');
  assert(activeRow === 'openai', `the active row should follow the selected provider, got ${activeRow}`);
  const bridgeLog = await desktop.locator('#settings-bridge-log').textContent();
  assert(/^(GET|POST|DELETE) \/\S+ → HTTP \d{3} · \d+ms$/.test(bridgeLog.trim()), `the bridge log should record the last request with its status and duration, got "${bridgeLog}"`);
  assert(!/test-key-not-a-real-secret|test-api-secret/.test(bridgeLog), 'bridge log leaked a key');
  const tabbables = await desktop.locator('.settings-dialog button:not([disabled]), .settings-dialog input:not([disabled]), .settings-dialog select:not([disabled]), .settings-dialog textarea:not([disabled])').count();
  const outside = await desktop.locator('.settings-dialog input').evaluateAll((nodes) => nodes.filter((node) => !node.closest('.settings-dialog')).length);
  assert(tabbables > 8, `settings tab trap is too narrow to reach the new controls (${tabbables})`);
  assert(outside === 0, 'settings inputs escaped the trap selector');
  await desktop.locator('[data-action="select-theme"][data-theme="midnight"]').click();
  assert(await desktop.locator('#app').getAttribute('data-theme') === 'midnight', 'midnight theme did not apply');
  await desktop.locator('[data-action="select-density"][data-density="compact"]').click();
  assert(await desktop.locator('#app').getAttribute('data-density') === 'compact', 'compact density did not apply');
  await desktop.keyboard.press('Escape');
  assert(await desktop.locator('#settings-modal').isHidden(), 'settings drawer did not close');

  // ------------------------------------------------------------------ 5. MCP drawer is live
  await desktop.locator('[data-action="nav-mcp"]').click();
  assert(await desktop.locator('#mcp-modal').isVisible(), 'MCP drawer did not open');
  const overview = await desktop.locator('#mcp-server-description').textContent();
  assert(overview.includes(`${catalog.total} tools`), `MCP overview should report the live catalog size, got "${overview}"`);
  const tierTiers = await desktop.locator('#mcp-tier-list [data-action="select-mcp-tier"]').evaluateAll((nodes) => nodes.map((node) => node.dataset.tier));
  // The manifest's `tiers` maps tool name -> tier, so the distinct values are the groups on offer.
  const offeredTiers = [...new Set(Object.values(catalog.tiers))].sort();
  for (const tier of offeredTiers) {
    assert(tierTiers.includes(tier), `MCP drawer is missing the ${tier} tier group, got ${tierTiers.join(', ')}`);
  }
  const untiered = catalog.tools.filter((tool) => !tool.tier).length;
  assert(untiered === 0 || tierTiers.includes('unknown'), `the drawer must surface ${untiered} untiered tools as their own group`);
  for (const tier of tierTiers) {
    const expected = tier === 'unknown' ? untiered : Object.values(catalog.tiers).filter((value) => value === tier).length;
    const rendered = await desktop.locator(`#mcp-tier-list [data-action="select-mcp-tier"][data-tier="${tier}"]`).textContent();
    assert(rendered.includes(String(expected)), `the ${tier} group should report ${expected} tools, got "${rendered}"`);
  }
  const shortlistHeader = await desktop.locator('#mcp-server-description').textContent();
  const shortlistCount = Number((shortlistHeader.match(/(\d+) of \d+ tools in this turn/) || [])[1]);
  assert(shortlistCount > 0, `drawer should announce the live shortlist, got "${shortlistHeader}"`);
  const inTurnBadges = await desktop.locator('.mcp-shortlist-badge:not(.is-out)').count();
  assert(inTurnBadges === shortlistCount, `shortlist header says ${shortlistCount} but ${inTurnBadges} tools are badged in this turn`);
  const excludedNames = ['call_tool', 'search_tools', 'create_client', 'reload_rbac', 'list_clients'];
  for (const name of excludedNames) {
    const listed = await desktop.locator(`.mcp-tool-option[data-tool="${name}"], .mcp-tool-option:has-text("${name}")`).count();
    const shortlisted = listed ? await desktop.locator(`.mcp-tool-option[data-tool="${name}"] .mcp-shortlist-badge:not(.is-out)`).count() : 0;
    assert(shortlisted === 0, `${name} must never be offered to a model in this turn`);
  }
  await desktop.locator('#mcp-search-input').fill('sales invoice');
  const narrowed = await desktop.locator('.mcp-tool-option').count();
  assert(narrowed > 0 && narrowed < 60, `token search should narrow the tool list, got ${narrowed}`);
  await desktop.keyboard.press('ArrowDown');
  assert(await desktop.evaluate(() => document.activeElement?.classList.contains('mcp-server-option') || document.activeElement?.classList.contains('mcp-tool-option')), 'arrow keys must move focus inside the MCP drawer');
  await desktop.keyboard.press('Enter');
  await desktop.locator('#mcp-search-input').fill('');
  const beforePrefill = await upstreamCalls();
  await desktop.locator('.mcp-tool-option:not([disabled])').first().click();
  assert(await desktop.locator('#mcp-modal').isHidden(), 'use-mcp-tool did not close the drawer');
  assert(await desktop.locator('#chat-view').isVisible(), 'use-mcp-tool did not switch to the conversation');
  const prefill = await desktop.locator('#chat-input').inputValue();
  assert(/^Use the \w+ tool to $/.test(prefill), `use-mcp-tool should prefill the composer, got "${prefill}"`);
  assert((await upstreamCalls()).length === beforePrefill.length, 'use-mcp-tool must never execute a tool by itself');
  await desktop.locator('#chat-input').fill('');
  await desktop.locator('[data-action="nav-mcp"]').click();
  assert(await desktop.locator('#mcp-modal').isVisible(), 'the MCP drawer did not reopen');
  await desktop.keyboard.press('Escape');
  assert(await desktop.locator('#mcp-modal').isHidden(), 'Escape did not close the MCP drawer');
  assert((await desktop.evaluate(() => document.activeElement?.dataset?.action || '')) === 'nav-mcp', 'closing the MCP drawer did not restore focus to its trigger');
  await desktop.locator('.chat-new-button').click();

  // ------------------------------------------------------------------ 6. audio
  const audioState = () => desktop.locator('.audio-dialog').getAttribute('data-audio-state');
  const waitAudio = (expected, timeout = 5000) =>
    desktop.waitForFunction((want) => document.querySelector('.audio-dialog')?.dataset.audioState === want, expected, { timeout });
  await desktop.locator('[data-action="audio-mode"]').click();
  assert(await desktop.locator('#audio-modal').isVisible(), 'audio drawer did not open');
  assert(await audioState() === 'idle', `audio initial state, got ${await audioState()}`);
  await desktop.locator('#audio-primary').click();
  await waitAudio('listening');
  await desktop.locator('#audio-primary').click();
  await waitAudio('processing');
  await waitAudio('playing');
  await desktop.locator('[data-action="audio-error"]').click();
  assert(await audioState() === 'error', 'audio error state');
  await desktop.locator('[data-action="audio-secondary"]').click();
  assert(await audioState() === 'idle', 'audio reset state');
  await desktop.keyboard.press('Escape');
  assert(await desktop.locator('#audio-modal').isHidden(), 'audio drawer did not close');

  // ------------------------------------------------------------------ 7. plain exchange over the real adapter
  await resetFake();
  await sendPrompt(desktop, 'browser validation');
  await desktop.waitForSelector('.typing-bubble', { timeout: 5000 });
  await idle(desktop);
  const plain = await desktop.evaluate(() => {
    const rows = window.aura.state.messages.filter((m) => m.role === 'assistant');
    const last = rows[rows.length - 1];
    return {
      text: (last.iterationTexts || []).join('\n\n'),
      tools: last.toolCount || 0,
      activity: last.activity,
      meta: document.querySelector('.response-meta')?.textContent || ''
    };
  });
  assert(plain.text.length > 0, 'a real provider reply produced no content');
  assert(plain.tools === 0, 'a plain turn must not invent tool calls');
  assert(!/Local prototype response/.test(plain.meta), 'the demo origin label survived a real provider reply');
  assert(/\btoken/i.test(plain.meta), `response meta should report token usage, got "${plain.meta}"`);
  assert(await desktop.locator('.response-code').count() === 0, 'a real provider must not render the demo code block');
  assert(await desktop.locator('.source-chip').count() === 0, 'a real provider must not render demo source chips');
  const firstRequest = (await upstreamRequests())[0] || {};
  assert(firstRequest.stream === true, 'the exchange should stream');
  assert(Array.isArray(firstRequest.tools) && firstRequest.tools.length > 0, 'the outbound request carried no tools');
  assert(firstRequest.tools.length <= 24, `the shortlist shipped ${firstRequest.tools.length} tools`);
  assert(firstRequest.messageRoles[0] === 'system' && firstRequest.messageRoles[1] === 'system', 'the two-part system prompt is missing');

  // ------------------------------------------------------------------ 8. retriever
  {
    const core = await desktop.evaluate(() => window.aura.retriever.core);
    const shipped = firstRequest.tools;
    for (const name of core) {
      assert(shipped.includes(name), `the always-on core tool ${name} is missing from the request`);
    }
    for (const name of shipped.slice(0, core.length)) {
      assert(core.includes(name), `core tools must lead the shortlist, but ${name} came first`);
    }
    const scoring = await desktop.evaluate(() => ({
      doc: window.aura.scoreTool('get_doc', 'show me the sales invoice'),
      employee: window.aura.scoreTool('get_employee', 'show me the sales invoice'),
      sales: window.aura.scoreTool('get_sales_invoice', 'show me the sales invoice')
    }));
    assert(scoring.sales.match > scoring.employee.match, 'a sales invoice query must rank a sales tool above an employee tool');
    const writeScores = await desktop.evaluate(() => window.aura.shortlist('show me the sales invoice').map((entry) => entry.tier));
    assert(!writeScores.includes('write') && !writeScores.includes('customize'), 'a read question must not put write tools in context');
    const writeIntent = await desktop.evaluate(() => window.aura.shortlist('create a new purchase receipt').map((entry) => entry.name));
    assert(writeIntent.some((name) => name.startsWith('create_') || name.startsWith('make_')), `a change request must reach mutating tools, got ${writeIntent.join(', ')}`);
    assert(!writeIntent.includes('call_tool'), 'call_tool must never be shortlisted');
  }

  // ------------------------------------------------------------------ 9. tool timeline row
  await resetFake();
  await freshChat(desktop);
  await setScenario('tool-read');
  await sendPrompt(desktop, 'show me sales invoice SI-0001');
  await desktop.waitForSelector('.tool-run[data-tool-run-id]', { timeout: 20000 });
  assert(await desktop.locator('.tool-run').count() === 1, 'expected exactly one tool row');
  assert(await desktop.locator('.message-row.tool-run').count() === 0, '.tool-run must not be a .message-row');
  const container = await desktop.evaluate(() => {
    const node = document.querySelector('.tool-runs');
    return { role: node?.getAttribute('role'), live: node?.getAttribute('aria-live'), label: node?.getAttribute('aria-label') };
  });
  assert(container.role === 'status' && container.live === 'polite', `tool container must announce progress, got ${JSON.stringify(container)}`);
  assert(/1 tool call/.test(container.label || ''), `tool container label is "${container.label}"`);
  assert(await desktop.locator('.tool-run-result').count() === 0, 'the disclosure must not materialise before the first expand');
  await desktop.locator('.tool-run-toggle').click();
  assert(await desktop.locator('.tool-run-result').count() === 1, 'the disclosure did not render the raw result');
  assert((await desktop.locator('.tool-run-result').textContent()).includes('SI-0001'), 'the disclosed result should be the tool payload');
  assert(await desktop.locator('.tool-run-toggle').getAttribute('aria-expanded') === 'true', 'the disclosure did not report its state');
  // Collapsing must not discard the rendered payload: the expensive half of the work is done once.
  await desktop.locator('.tool-run-toggle').click();
  assert(await desktop.locator('.tool-run-toggle').getAttribute('aria-expanded') === 'false', 'collapsing did not report its state');
  assert((await desktop.evaluate(() => window.aura.toolRuns.filter((run) => run.disclosureRendered).length)) === 1, 'the row forgot it had already rendered its result');
  await idle(desktop);
  assert(await desktop.locator('.tool-run[data-status="done"]').count() === 1, 'the tool row never resolved to done');
  const rowText = await desktop.locator('.tool-run').textContent();
  assert(rowText.includes('get_doc'), `the row should name the tool, got "${rowText}"`);
  assert(/Sales Invoice/.test(rowText) && /SI-0001/.test(rowText), `the row should summarise the arguments, got "${rowText}"`);
  assert(await desktop.locator('.tool-run[data-tier]').count() === 0, 'a read tool must not wear a tier badge');
  const rowMeta = await desktop.locator('.response-meta > span:last-child').textContent();
  assert(/^1 tool\b/.test(rowMeta.trim()), `response meta should lead with the tool count, got "${rowMeta}"`);
  const order = await desktop.evaluate(() => [...document.querySelectorAll('#chat-messages > *')].map((node) => node.className));
  assert(order[0].includes('user') && order[1].includes('tool-runs') && order[2].includes('assistant'), `rows must sit between the user turn and the bubble, got ${order.join(' | ')}`);

  // ------------------------------------------------------------------ 10. tool error, exchange continues
  await resetFake();
  await freshChat(desktop);
  await setScenario('tool-error');
  await sendPrompt(desktop, 'run the flaky ledger tool');
  await desktop.waitForSelector('.tool-run[data-status="error"]', { timeout: 20000 });
  const errorText = await desktop.locator('.tool-run').textContent();
  assert(/ledger is locked/i.test(errorText), `the row should surface the server's own error text, got "${errorText}"`);
  await idle(desktop);
  const recovered = await desktop.evaluate(() => {
    const rows = window.aura.state.messages.filter((m) => m.role === 'assistant');
    return (rows[rows.length - 1]?.iterationTexts || []).join('\n\n');
  });
  assert(recovered.length > 0, 'a failed tool must not end the exchange silently');
  assert(/did not (succeed|make the change)|nothing to report/i.test(recovered), `the model should refuse to claim success, got "${recovered}"`);
  assert((await upstreamRequests()).length >= 2, 'a failed tool must be fed back so the model can continue');

  // ------------------------------------------------------------------ 11. approval: nothing leaves without consent
  await resetFake();
  await freshChat(desktop);
  await setScenario('tool-write');
  await sendPrompt(desktop, 'create a new Sales Invoice for Acme');
  await desktop.waitForSelector('#approval-modal:not([hidden])', { timeout: 20000 });
  const gate = await desktop.evaluate(() => ({
    title: document.querySelector('#approval-title')?.textContent,
    summary: document.querySelector('#approval-summary')?.textContent,
    badge: document.querySelector('#approval-tier-badge')?.textContent,
    grant: document.querySelector('#approval-grant-tool')?.textContent,
    target: document.querySelector('#approval-target-label')?.textContent,
    args: document.querySelector('#approval-args-code')?.textContent,
    role: document.querySelector('.approval-dialog')?.getAttribute('role'),
    focus: document.activeElement?.className
  }));
  assert(gate.role === 'alertdialog', 'the gate must be an alertdialog');
  assert(gate.grant === 'create_doc', `the gate should name the tool, got "${gate.grant}"`);
  assert(gate.badge === 'Write', `a write tool must be badged Write, got "${gate.badge}"`);
  assert(/Sales Invoice/.test(gate.target || ''), `the gate should name the target doctype, got "${gate.target}"`);
  assert(/Sales Invoice/.test(gate.args || ''), `the gate must show the exact arguments, got "${gate.args}"`);
  assert(/approval-approve/.test(gate.focus || ''), `focus must land on Approve, got "${gate.focus}"`);
  assert((await upstreamCalls()).length === 0, 'a tools/call reached the upstream before the user approved');

  // Escape rejects this one call without aborting the exchange.
  await desktop.keyboard.press('Escape');
  await desktop.waitForSelector('.tool-run[data-status="rejected"]', { timeout: 15000 });
  assert((await upstreamCalls()).length === 0, 'a rejected tool still reached the upstream');
  assert((await upstreamRequests()).length >= 2, 'Escape rejected the call but must not kill the exchange');
  await idle(desktop);

  // Approve, and the arguments must be byte-identical to what the dialog showed.
  await resetFake();
  await freshChat(desktop);
  await setScenario('tool-write');
  await sendPrompt(desktop, 'create a new Sales Invoice for Acme');
  await desktop.waitForSelector('#approval-modal:not([hidden])', { timeout: 20000 });
  const shownArgs = await desktop.locator('#approval-args-code').textContent();
  await desktop.locator('.approval-approve').click();
  await desktop.waitForSelector('.tool-run[data-status="done"]', { timeout: 20000 });
  const calls = await upstreamCalls();
  assert(calls.length === 1, `Approve must send exactly one call, sent ${calls.length}`);
  const sent = JSON.stringify(calls[0].args);
  assert(sent === JSON.stringify(JSON.parse(shownArgs)), `the approved arguments differ from the dialog: sent ${sent}`);
  assert(typeof calls[0].args.request_id === 'string' && calls[0].args.request_id.length > 0, 'a mutating call must carry a request_id');
  assert((await desktop.evaluate(() => window.aura.grants().length)) === 0, 'Approve must not silently grant the tool for the conversation');
  await idle(desktop);

  // "Allow for this conversation" covers the same tool only.
  await resetFake();
  await freshChat(desktop);
  await setScenario('multi-write');
  await sendPrompt(desktop, 'create two Sales Invoices and delete the draft one');
  await desktop.waitForSelector('#approval-modal:not([hidden])', { timeout: 20000 });
  await desktop.locator('#approval-grant-input').check();
  await desktop.locator('.approval-approve').click();
  // The three calls run in parallel, so all three gates were queued before the first was answered.
  // Granting create_doc must therefore dismiss its queued sibling and surface the ungranted one.
  const nextGate = await desktop.waitForFunction(() => {
    const node = document.querySelector('#approval-grant-tool');
    return node && node.textContent ? node.textContent : false;
  }, null, { timeout: 20000 }).then((handle) => handle.jsonValue());
  assert(nextGate === 'delete_doc', `a different tool must still gate, but the next gate is for ${nextGate}`);
  await desktop.locator('.approval-reject').click();
  await idle(desktop);
  const grantedCalls = await upstreamCalls();
  assert(grantedCalls.filter((call) => call.name === 'create_doc').length === 2, 'the granted tool should have run twice');
  assert(grantedCalls.every((call) => call.name !== 'delete_doc'), 'a rejected different tool still reached the upstream');

  // Aborting mid-gate must resolve the gate, never leave it pending.
  await resetFake();
  await freshChat(desktop);
  await setScenario('tool-write');
  await sendPrompt(desktop, 'create a new Sales Invoice for Acme');
  await desktop.waitForSelector('#approval-modal:not([hidden])', { timeout: 20000 });
  await desktop.evaluate(() => window.aura.stop());
  await desktop.waitForSelector('#approval-modal[hidden]', { state: 'attached', timeout: 15000 });
  assert((await upstreamCalls()).length === 0, 'an aborted gate still sent a call');
  assert((await desktop.evaluate(() => window.aura.approval())) === null, 'the approval gate was left pending after an abort');
  await idle(desktop);
  const abortedRow = await desktop.evaluate(() => window.aura.toolRuns.map((run) => run.status));
  assert(JSON.stringify(abortedRow) === '["cancelled"]', `an aborted gate should leave its row cancelled, got ${abortedRow.join(', ')}`);

  // ------------------------------------------------------------------ 12. stop
  await resetFake();
  await freshChat(desktop);
  await setScenario('slow-tool');
  await sendPrompt(desktop, 'run the slow tool then keep going');
  await desktop.waitForSelector('.tool-run[data-status="running"]', { timeout: 20000 });
  assert(await desktop.locator('#chat-send-btn').getAttribute('data-action') === 'stop-response', 'the send control did not become a stop control');
  await desktop.waitForTimeout(400);
  await desktop.locator('#chat-send-btn').click();
  await desktop.waitForSelector('.tool-run[data-status="cancelled"]', { timeout: 20000 });
  assert((await desktop.locator('.response-meta').last().textContent()).includes('Stopped by you'), 'the stopped state is missing from the response meta');
  await desktop.waitForFunction(() => true);
  await desktop.waitForTimeout(1200);
  assert((await inFlight()) === 0, `Stop leaked an upstream connection (inFlight=${await inFlight()})`);
  // The call is logged the moment the server receives it, so the leak proof is the connection count,
  // not the call log: what must not happen is the server's payload arriving.
  const cancelledRun = await desktop.evaluate(() => {
    const run = window.aura.toolRuns[0];
    return { status: run.status, error: run.error, value: run.resultValue || null, text: run.resultText || '' };
  });
  assert(cancelledRun.status === 'cancelled', `the row should read cancelled, got ${cancelledRun.status}`);
  assert(/Stopped before the call finished/.test(cancelledRun.error || ''), `the row should say why, got "${cancelledRun.error}"`);
  assert(cancelledRun.value === null && cancelledRun.text === '{"status":"cancelled"}', `a cancelled call must carry no server payload, got ${JSON.stringify(cancelledRun.value ?? cancelledRun.text)}`);

  // ------------------------------------------------------------------ 13. demo transport is untouched
  await resetFake();
  await freshChat(desktop);
  const beforeDemo = (await upstreamRequests()).length;
  await desktop.evaluate(() => window.aura.setProvider('demo'));
  await sendPrompt(desktop, 'describe the staged files');
  await desktop.waitForSelector('.typing-bubble', { timeout: 5000 });
  await idle(desktop);
  assert(await desktop.locator('.response-code').count() === 1, 'the demo transport lost its code block');
  assert(await desktop.locator('.tool-run').count() === 0, 'the demo transport must not fabricate tool activity');
  assert((await upstreamRequests()).length === beforeDemo, 'the demo transport contacted the network');
  assert(/offline preview/i.test(await desktop.locator('#chat-session-mode').textContent()), 'the session mode should name the demo transport');
  await desktop.evaluate(() => window.aura.setProvider('openai'));

  // ------------------------------------------------------------------ 14. session history, edit, regenerate
  await resetFake();
  await freshChat(desktop);
  await setScenario('auto');
  await sendPrompt(desktop, 'browser validation');
  await idle(desktop);
  const activeSessionId = await desktop.locator('.session-row.is-active').getAttribute('data-session-id');
  assert(activeSessionId, 'active in-memory session row is missing');
  assert((await desktop.locator('.session-row.is-active').textContent()).includes('browser validation'), 'active session title is incorrect');
  await desktop.locator('.chat-new-button').click();
  await desktop.locator(`.session-row[data-session-id="${activeSessionId}"]`).click();
  assert(await desktop.locator('#chat-view').isVisible(), 'resuming a session did not open chat');
  assert((await desktop.locator('#chat-title').textContent()).includes('browser validation'), 'resumed session title is missing');
  await desktop.locator('#chat-input').fill('unsent draft to restore');
  await desktop.locator('[data-session-id="pinned-roadmap"]').click();
  await desktop.locator(`.session-row[data-session-id="${activeSessionId}"]`).click();
  assert(await desktop.locator('#chat-input').inputValue() === 'unsent draft to restore', 'session-owned chat draft was not restored');
  await desktop.locator('.message-row.user').first().locator('[data-action="edit-message"]').click();
  assert(await desktop.locator('#chat-send-btn').getAttribute('data-action') === 'save-edit', 'edit save control is missing');
  await desktop.locator('#chat-input').fill('edited branch question');
  await desktop.locator('#chat-input').press('Enter');
  await idle(desktop);
  assert(await desktop.locator('.message-row.user').count() === 1, 'editing did not remove later turns');
  const firstAssistant = desktop.locator('.message-row.assistant').first();
  await firstAssistant.locator('[data-action="rate-message"][data-rating="up"]').click();
  assert(await firstAssistant.locator('[data-action="rate-message"][data-rating="up"]').getAttribute('aria-pressed') === 'true', 'rating pressed state is missing');
  await resetFake();
  await firstAssistant.locator('[data-action="regenerate-message"]').click();
  await desktop.waitForFunction(() => !window.aura.state.busy, null, { timeout: 30000 });
  assert(await desktop.locator('.message-row.user').count() === 1, 'selected-turn regeneration changed the wrong turn');
  await desktop.locator('.message-row.user').first().locator('[data-action="edit-message"]').click();
  await desktop.locator('[data-session-id="pinned-roadmap"]').click();
  assert(await desktop.locator('#chat-edit-status').isHidden(), 'session switch left edit mode active');
  await desktop.keyboard.press('Control+KeyK');
  await desktop.locator('#search-modal-input').fill('browser validation');
  assert(await desktop.locator('.search-result').count() >= 1, 'in-memory session is missing from search');
  await desktop.keyboard.press('Escape');
  assertClean(errors, 'desktop application');

  // ------------------------------------------------------------------ 15. a failing provider errors loudly on its own page
  {
    const failing = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const failingErrors = attachErrors(failing);
    await failing.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await failing.waitForFunction(() => window.aura && window.aura.state.activeProvider === 'openai', null, { timeout: 25000 });
    await resetFake();
    await setScenario('error-http', { httpStatus: 503, failures: 1 });
    await failing.fill('#prompt-input', 'this upstream is down');
    await failing.click('[data-action="send-prompt"]');
    await failing.waitForSelector('[data-action="retry-response"]', { timeout: 40000 });
    const failureText = await failing.locator('.response-code').last().textContent();
    assert(/503|unavailable|unreachable/i.test(failureText), `the failure should name the upstream status, got "${failureText}"`);
    assert((await failing.evaluate(() => window.aura.state.activeProvider)) === 'openai', 'a failing provider must not silently fall back to demo');
    assert(failingErrors.pageErrors.length === 0, `failing-provider page threw: ${failingErrors.pageErrors.join('; ')}`);
    await failing.close();
  }

  // ------------------------------------------------------------------ 16. responsive matrix
  for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 900 }, { width: 320, height: 800 }]) {
    const matrixPage = await browser.newPage({ viewport, isMobile: viewport.width < 900 });
    const matrixErrors = attachErrors(matrixPage);
    await matrixPage.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await matrixPage.waitForFunction(() => window.aura && window.aura.state.mcp.status === 'ready', null, { timeout: 25000 });
    assert(await matrixPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${viewport.width}px viewport overflows`);
    // Both drawers are reachable from always-visible chrome, so the narrow layouts are measured
    // without first negotiating the off-canvas sidebar.
    for (const [trigger, selector] of [['.profile-button[data-action="profile"]', '.settings-dialog'], ['.staging-icon-button[data-action="mcp"]', '.mcp-dialog']]) {
      await matrixPage.locator(trigger).click();
      assert(await matrixPage.locator(selector).evaluate((element) => element.getBoundingClientRect().width <= innerWidth), `${viewport.width}px ${selector} exceeds the viewport`);
      await matrixPage.keyboard.press('Escape');
    }
    await matrixPage.evaluate(() => window.aura.newChat());
    await matrixPage.evaluate(() => { document.querySelector('[data-action="nav-chat"]')?.click(); });
    assert(await matrixPage.locator('#chat-view').isVisible(), `${viewport.width}px chat view did not open`);
    assert(await matrixPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${viewport.width}px chat view overflows`);
    assert(await matrixPage.locator('.tool-run').count() <= 0, `${viewport.width}px must not render rows in an empty chat`);
    assertClean(matrixErrors, `${viewport.width}px application`);
    await matrixPage.close();
  }

  // Tool rows must survive the narrow layouts, so drive one real exchange at 390px.
  {
    const narrow = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
    const narrowErrors = attachErrors(narrow);
    await narrow.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await narrow.waitForFunction(() => window.aura && window.aura.state.mcp.status === 'ready', null, { timeout: 25000 });
    await resetFake();
    await setScenario('tool-read');
    await narrow.fill('#prompt-input', 'show me sales invoice SI-0001');
    await narrow.click('[data-action="send-prompt"]');
    await narrow.waitForSelector('.tool-run', { timeout: 20000 });
    await idle(narrow);
    assert(await narrow.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'a tool row overflows the 390px viewport');
    assert(await narrow.locator('.tool-run-name').evaluate((node) => node.getBoundingClientRect().right <= innerWidth), 'the tool name overflows the 390px viewport');
    assertClean(narrowErrors, '390px tool-row application');
    await narrow.close();
  }

  console.log('Browser checks passed: static API ban, no committed secrets, degraded file:// page, provider discovery, staging, camera, search, commands, settings providers and tab trap, live MCP tiers and shortlist, keyboard navigation, audio, real-provider streaming, retriever shortlist, tool timeline rows, tool error recovery, write approval and conversation grants, stop and abort, demo transport, session history, provider failure, and the responsive matrix');
} finally {
  if (browser) await browser.close();
  await stopChild(bridge);
  await stopChild(fake);
}
