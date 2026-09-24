import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const sourcePath = path.resolve('code.html');
const source = fs.readFileSync(sourcePath, 'utf8');
const sourceUrl = pathToFileURL(sourcePath).href;
const scriptMatches = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];

for (const [index, match] of scriptMatches.entries()) {
  new vm.Script(match[1], { filename: `code-inline-${index}.js` });
}

const ids = [...source.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicateIds.length) throw new Error(`Duplicate HTML ids: ${duplicateIds.join(', ')}`);
if (/\b(innerHTML|localStorage|sessionStorage)\b/.test(source)) throw new Error('Unsafe user-content or persistence API found');

console.log(`Static checks passed: ${scriptMatches.length} scripts, ${ids.length} unique ids`);

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

const browser = await chromium.launch({
  headless: true,
  ...(process.env.AURA_CHROMIUM_PATH ? { executablePath: process.env.AURA_CHROMIUM_PATH } : {})
});

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.goto(sourceUrl);
  await page.waitForTimeout(350);

  assert(await page.locator('.staged-file').count() === 3, 'default staged files are missing');
  assert(await page.locator('#staging-composer-card').getAttribute('data-state') === 'ready', 'initial staging state is not ready');
  assert(await page.locator('#staging-onboarding').isHidden(), 'onboarding should be hidden with files');

  await page.keyboard.press('Control+KeyK');
  assert(await page.locator('#search-modal').isVisible(), 'global search did not open');
  await page.locator('#search-modal-input').fill('kubernetes');
  assert(await page.locator('.search-result').count() === 1, 'global search filtering failed');
  await page.keyboard.press('Enter');
  assert(await page.locator('#search-modal').isHidden(), 'global search did not close after selection');
  assert((await page.locator('#prompt-input').inputValue()).includes('deployment configuration'), 'search result was not inserted');

  await page.locator('#prompt-input').fill('/');
  assert(await page.locator('#command-menu').isVisible(), 'slash command menu did not open');
  await page.keyboard.press('Enter');
  assert(await page.locator('#command-menu').isHidden(), 'slash command menu did not close');

  while (await page.locator('.staged-file-remove').count()) {
    await page.locator('.staged-file-remove').first().click();
    await page.waitForTimeout(30);
  }
  assert(await page.locator('#staging-composer-card').getAttribute('data-state') === 'empty', 'empty staging state is missing');
  assert(await page.locator('#staging-onboarding').isVisible(), 'onboarding state is missing');
  await page.locator('#staged-file-input').setInputFiles({ name: 'validation.json', mimeType: 'application/json', buffer: Buffer.from('{"ok":true}') });
  assert(await page.locator('#staging-composer-card').getAttribute('data-state') === 'loading', 'loading staging state is missing');
  await page.waitForTimeout(650);
  assert(await page.locator('#staging-composer-card').getAttribute('data-state') === 'success', 'success staging state is missing');
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await dataTransfer.evaluate((transfer) => transfer.items.add(new File(['drag content'], 'drag.md', { type: 'text/markdown' })));
  await page.locator('#staged-drop-zone').dispatchEvent('dragenter', { dataTransfer });
  await page.locator('#staged-drop-zone').dispatchEvent('drop', { dataTransfer });
  await page.waitForTimeout(650);
  assert((await page.locator('.staged-file-name').allTextContents()).includes('drag.md'), 'drag/drop did not stage metadata');

  await page.locator('[data-action="nav-settings"]').click();
  assert(await page.locator('#settings-modal').isVisible(), 'settings drawer did not open');
  await page.locator('[data-action="select-settings-model"][data-model="Claude 3.7 Opus"]').click();
  assert((await page.locator('[data-model-label]').first().textContent()).includes('Opus'), 'settings model did not synchronize');
  await page.keyboard.press('Escape');
  assert(await page.locator('#settings-modal').isHidden(), 'settings drawer did not close');

  await page.locator('[data-action="nav-mcp"]').click();
  assert(await page.locator('#mcp-modal').isVisible(), 'MCP drawer did not open');
  assert(await page.locator('.mcp-server-option').count() === 4, 'MCP server list is incomplete');
  assert(await page.locator('.mcp-tool-option').count() === 2, 'MCP tool list is incomplete');
  await page.locator('#mcp-search-input').fill('github');
  assert((await page.locator('#mcp-server-heading').textContent()) === 'GitHub', 'MCP search did not select matching server');
  await page.locator('[data-action="use-mcp-tool"]').first().click();
  assert(await page.locator('#mcp-modal').isHidden(), 'MCP tool action did not close drawer');

  await page.locator('#prompt-input').fill('browser validation');
  await page.locator('#send-prompt-btn').click();
  assert(await page.locator('.typing-bubble').count() === 1, 'chat typing state is missing');
  await page.waitForTimeout(1050);
  assert(await page.locator('.message-code').count() === 1, 'mock response is missing');
  assert(errors.length === 0, `desktop application errors: ${errors.join('; ')}`);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  const mobileErrors = [];
  mobile.on('pageerror', (error) => mobileErrors.push(`pageerror: ${error.message}`));
  mobile.on('console', (message) => {
    if (message.type() === 'error') mobileErrors.push(`console: ${message.text()}`);
  });
  await mobile.goto(`file://${sourcePath}`);
  await mobile.waitForTimeout(300);
  assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile viewport overflows');
  await mobile.locator('[data-action="profile"]').click();
  assert(await mobile.locator('#settings-modal').isVisible(), 'mobile settings did not open');
  assert(await mobile.locator('.settings-dialog').evaluate((element) => element.getBoundingClientRect().width <= innerWidth), 'mobile settings exceed viewport');
  await mobile.keyboard.press('Escape');
  assert(await mobile.locator('#settings-modal').isHidden(), 'mobile settings did not close');
  await mobile.locator('#sidebar-toggle').click();
  await mobile.locator('.integration-row[data-action="mcp"]').click();
  assert(await mobile.locator('#mcp-modal').isVisible(), 'mobile MCP drawer did not open');
  assert(await mobile.locator('.mcp-dialog').evaluate((element) => element.getBoundingClientRect().width <= innerWidth), 'mobile MCP drawer exceeds viewport');
  await mobile.keyboard.press('Escape');
  assert(await mobile.locator('#mcp-modal').isHidden(), 'mobile MCP drawer did not close');
  assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile overflow after settings');
  assert(mobileErrors.length === 0, `mobile application errors: ${mobileErrors.join('; ')}`);

  console.log('Browser checks passed: desktop, direct file, search, commands, staging, settings, MCP, chat, and mobile');
} finally {
  await browser.close();
}
