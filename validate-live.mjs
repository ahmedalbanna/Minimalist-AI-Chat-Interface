#!/usr/bin/env node
// Opt-in smoke test against the real services. Never runs by default: it talks to a real model and a
// real Frappe gateway, and a real exchange costs tokens.
//
//   AURA_LIVE=1 npm run validate:live
//   AURA_LIVE=1 AURA_LIVE_URL=http://127.0.0.1:8790 node validate-live.mjs
//
// With no AURA_LIVE_URL it spawns its own aura-server.mjs on a free port and kills it on the way out.
// It reads no credentials: every secret lives in the bridge's environment, and this script only ever
// speaks HTTP to the bridge. Nothing it prints may contain a key or an Authorization header.

import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MCP_TIMEOUT_MS = 15000;

if (process.env.AURA_LIVE !== '1') {
  console.log('validate-live: skipped (set AURA_LIVE=1 to run against real services)');
  process.exit(0);
}

const results = [];
let failures = 0;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  // Routed through say() so the credential guard sees check details too, not just the summary block.
  say(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` - ${detail}` : ''}`);
}

function section(title) {
  console.log(`\n${title}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Nothing printed may look like a credential. A smoke test that leaks a key into CI logs is worse than
// no smoke test, so the guard is a regex over the whole output rather than a promise to be careful.
const SECRET_PATTERN = /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b|\bauthorization\s*:/i;
const printed = [];
function say(line) {
  printed.push(String(line));
  console.log(line);
}

function startBridge(port) {
  const child = spawn(process.execPath, [path.join(ROOT, 'aura-server.mjs')], {
    env: { ...process.env, AURA_HOST: '127.0.0.1', AURA_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.resume();
  child.stderr.resume();
  return child;
}

async function waitForHealth(base, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return response.json();
    } catch (error) {
      // The bridge is still binding.
    }
    await sleep(150);
  }
  throw new Error(`the bridge never answered /api/health on ${base}`);
}

// Mirrors McpClient on the page: tolerant framing, session id replayed but never required, and a lazy
// re-initialize when the gateway retires the session. The gateway invalidates a session after every
// tools/call, so a smoke test that does not do this reports a false failure.
function parseEnvelope(rawText) {
  const trimmed = (rawText || '').trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^data: ([\s\S]*)$/m);
  const candidate = match ? match[1] : trimmed;
  if (!candidate || candidate === '[DONE]') return null;
  try {
    return JSON.parse(candidate);
  } catch (error) {
    return null;
  }
}

function unwrapToolResult(text) {
  let outer = null;
  try {
    outer = JSON.parse(text);
  } catch (error) {
    return { status: 'ok', value: text, error: '' };
  }
  let value = outer;
  if (outer && typeof outer.result === 'string') {
    try {
      value = JSON.parse(outer.result);
    } catch (error) {
      value = outer.result;
    }
  }
  const status = outer && typeof outer.status === 'string' ? outer.status : 'ok';
  const innerStatus = value && typeof value === 'object' && typeof value.status === 'string' ? value.status : null;
  const effective = innerStatus || status;
  const message = effective === 'ok' ? '' : String((value && (value.error || value.message)) || outer.error || outer.message || `tool reported ${effective}`);
  return { status: effective, value, error: message };
}

class LiveMcpClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.sessionId = null;
    this.protocolVersion = null;
    this.nextId = 1;
  }

  async post(payload, signal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
    try {
      const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
      if (this.sessionId) {
        headers['mcp-session-id'] = this.sessionId;
        if (this.protocolVersion) headers['MCP-Protocol-Version'] = this.protocolVersion;
      }
      return await fetch(this.baseUrl, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async initialize() {
    const response = await this.post({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'aura-live-smoke', version: '1.0.0' } }
    });
    const sid = response.headers.get('mcp-session-id') || response.headers.get('Mcp-Session-Id');
    if (sid) this.sessionId = sid;
    const body = parseEnvelope(await response.text());
    if (!response.ok || !body || body.error) {
      throw new Error(`initialize failed: HTTP ${response.status} ${body && body.error ? body.error.message : 'no result'}`);
    }
    this.protocolVersion = body.result?.protocolVersion || this.protocolVersion;
    this.serverInfo = body.result?.serverInfo?.name || 'unknown';
    return body.result;
  }

  async request(method, params) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!this.sessionId) await this.initialize();
      const response = await this.post({ jsonrpc: '2.0', id: this.nextId++, method, params });
      if (response.status === 404) {
        // Session retired. Re-handshake and replay once; a second 404 is a real failure.
        this.sessionId = null;
        continue;
      }
      const raw = await response.text();
      if (response.status === 202 || !raw.trim()) return {};
      const body = parseEnvelope(raw);
      if (!response.ok) throw new Error(`${method} failed: HTTP ${response.status} ${body?.error?.message || ''}`.trim());
      if (body?.error) throw new Error(`${method} returned an error: ${body.error.message}`);
      return body.result || {};
    }
    throw new Error(`${method} still failed after re-initializing`);
  }

  async listTools() {
    const tools = [];
    let cursor;
    for (let page = 0; page < 50; page += 1) {
      const result = await this.request('tools/list', cursor ? { cursor } : {});
      if (Array.isArray(result.tools)) tools.push(...result.tools);
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    return tools;
  }

  async callTool(name, args) {
    const result = await this.request('tools/call', { name, arguments: { ...args, request_id: `aura-live-${Date.now().toString(36)}` } });
    const text = Array.isArray(result.content) ? result.content.map((part) => part.text || '').join('\n') : '';
    return { isError: result.isError === true, ...unwrapToolResult(text) };
  }
}

async function runLiveExchange(base, provider) {
  // The bridge advertises where to POST, so this script never hardcodes a provider's request path and
  // stays correct if the page and the bridge are pointed at different upstreams.
  const url = `${base}${provider.baseUrl}${provider.requestPath || ''}`;
  if (provider.transport === 'ollama-chat') {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: provider.modelId,
        stream: true,
        messages: [
          { role: 'system', content: 'Answer in one short sentence.' },
          { role: 'user', content: 'What is an ERPNext Sales Invoice? One sentence.' }
        ]
      })
    });
    if (!response.ok) throw new Error(`${provider.requestPath} replied ${response.status} ${(await response.text()).slice(0, 200)}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          try {
            const frame = JSON.parse(line);
            if (frame.message?.content) text += frame.message.content;
          } catch (error) {
            // A partial line is not an error here; the residual buffer is drained on the next chunk.
          }
        }
        newline = buffer.indexOf('\n');
      }
    }
    return { text: text.trim(), usage: null };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: provider.modelId,
      stream: true,
      max_tokens: 120,
      messages: [
        { role: 'system', content: 'Answer in one short sentence.' },
        { role: 'user', content: 'What is an ERPNext Sales Invoice? One sentence.' }
      ]
    })
  });
  if (!response.ok) throw new Error(`${provider.requestPath} replied ${response.status} ${(await response.text()).slice(0, 200)}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const frame = JSON.parse(data);
          const delta = frame.choices?.[0]?.delta?.content;
          if (delta) text += delta;
        } catch (error) {
          // A frame split across two chunks is handled by the residual buffer on the next read.
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
  return { text: text.trim(), usage: null };
}

async function main() {
  const external = process.env.AURA_LIVE_URL;
  let child = null;
  let base = external;
  if (!base) {
    const port = await freePort();
    child = startBridge(port);
    base = `http://127.0.0.1:${port}`;
  }
  base = base.replace(/\/+$/, '');

  const client = new LiveMcpClient(null);
  try {
    section('bridge');
    const health = await waitForHealth(base);
    record('GET /api/health', health && health.ok === true, `ok=${health && health.ok}`);
    const configResponse = await fetch(`${base}/api/config`);
    const config = await configResponse.json();
    // An empty AURA_MCP_SITE is the correct configuration: the gateway's own default site is used and
    // sending a mismatched X-Frappe-Site is a 401.
    record('GET /api/config', configResponse.ok, `site=${config.mcp?.site || 'default'} fiscalYear=${config.fiscalYear?.label}`);

    section('providers');
    const healthProviders = health.providers || {};
    for (const id of ['openai', 'ollama']) {
      const entry = healthProviders[id] || {};
      if (!entry.configured) {
        console.log(`  skip  ${id} - not configured (set the env vars named in /api/config)`);
        continue;
      }
      record(`${id} reachable`, entry.reachable === true, `${(entry.chatModels || []).length} chat models`);
    }

    const live = (Object.values(config.providers || {}))
      .filter((entry) => entry.configured && entry.transport !== 'mock' && entry.modelId);
    const preferred = live.find((entry) => entry.id === 'openai') || live[0];

    section('mcp');
    client.baseUrl = `${base}${config.mcp.baseUrl}`;
    if (!config.mcp.configured) {
      record('mcp configured', false, 'set AURA_MCP_URL and FRAPPE_API_KEY / FRAPPE_API_SECRET');
    } else {
      const initialized = await client.initialize();
      record('initialize', true, `${client.serverInfo} protocol ${initialized.protocolVersion}`);
      const tools = await client.listTools();
      record('tools/list returns more than 100 tools', tools.length > 100, `${tools.length} tools for this client`);
      const manifest = await client.callTool('get_tool_manifest', {});
      const tiers = manifest.value?.data?.tiers || manifest.value?.tiers || {};
      const counts = Object.values(tiers).reduce((acc, tier) => {
        acc[tier] = (acc[tier] || 0) + 1;
        return acc;
      }, {});
      record('get_tool_manifest returns tiers', Object.keys(tiers).length > 0, Object.entries(counts).map(([tier, n]) => `${tier} ${n}`).join(', '));
      const probe = await client.callTool('list_doctypes', { limit: 5 });
      record('a real read tool call succeeds', probe.status === 'ok', `status=${probe.status}${probe.error ? ` ${probe.error}` : ''}`);

      section('exchange');
      if (!preferred) {
        record('a provider is configured', false, 'set OPENAI_API_KEY / OLLAMA_URL to run a real exchange');
      } else {
        const started = Date.now();
        const exchange = await runLiveExchange(base, preferred);
        record(`${preferred.id} exchange returns text`, exchange.text.length > 0, `${exchange.text.length} chars in ${Date.now() - started}ms`);
        if (exchange.text) say(`  model replied: "${exchange.text.slice(0, 160)}"`);
      }

      section('summary');
      const summaryProvider = preferred ? `${preferred.label} (${preferred.modelId})` : 'none configured';
      const summarySite = config.mcp.siteHeaderSent ? `${config.mcp.upstream} @ ${config.mcp.site || 'default'}` : `${config.mcp.upstream} @ default site`;
      say(`  provider   ${summaryProvider}`);
      say(`  gateway    ${summarySite}`);
      say(`  tools      ${tools.length} available, ${Object.keys(tiers).length} tiered in the manifest`);
      say(`  date       ${config.today} (fiscal year ${config.fiscalYear?.label})`);
    }
  } catch (error) {
    record('live smoke', false, error && error.message ? error.message : String(error));
  } finally {
    if (child) child.kill('SIGTERM');
  }

  const output = printed.join('\n');
  if (SECRET_PATTERN.test(output)) {
    console.log('\nFAIL  the output contains something shaped like a credential and must not be shared.');
    failures += 1;
  }

  const passed = results.filter((entry) => entry.ok).length;
  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}  ${passed}/${results.length} live checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
