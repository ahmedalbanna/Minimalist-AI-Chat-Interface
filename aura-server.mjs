#!/usr/bin/env node
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dns from 'node:dns/promises';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = path.join(ROOT, 'code.html');
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const HEALTH_TIMEOUT_MS = 1500;
const HOST_CACHE_MS = 30000;
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);

const env = {
  host: process.env.AURA_HOST || '127.0.0.1',
  port: Number(process.env.AURA_PORT || 8790),
  allowRemote: process.env.AURA_ALLOW_REMOTE === '1',
  fiscalYearStartMonth: clampMonth(process.env.AURA_FISCAL_YEAR_START_MONTH),
  openaiKey: process.env.OPENAI_API_KEY || '',
  openaiBase: trimSlash(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'),
  openaiModel: process.env.OPENAI_MODEL || '',
  ollamaUrl: trimSlash(process.env.OLLAMA_URL || 'http://127.0.0.1:11435'),
  ollamaModel: process.env.OLLAMA_MODEL || '',
  mcpUrl: process.env.AURA_MCP_URL || '',
  mcpSite: process.env.AURA_MCP_SITE || '',
  frappeKey: process.env.FRAPPE_API_KEY || '',
  frappeSecret: process.env.FRAPPE_API_SECRET || '',
};

const EMBED_HINT = /(^|[-_:.])((embed|embedding|embeddings|bge|gte|e5|whisper|clip|tts|rerank|moderation|vision))([-_.:]|$)/i;

function clampMonth(raw) {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : 4;
}

function trimSlash(url) {
  return url.replace(/\/+$/, '');
}

function isLoopbackAddress(address) {
  const a = address.toLowerCase();
  if (a === '::1' || a === '0:0:0:0:0:0:0:1') return true;
  if (a.startsWith('::ffff:')) return isLoopbackAddress(a.slice(7));
  return /^127\./.test(a);
}

function isNeverAllowedAddress(address) {
  const a = address.toLowerCase();
  if (a === '::' || a === '0:0:0:0:0:0:0:0') return true;
  if (a === '::1' || a === '0:0:0:0:0:0:0:1') return true;
  if (a.startsWith('::ffff:')) return isNeverAllowedAddress(a.slice(7));
  const parts = a.split('.');
  if (parts.length === 4) {
    const octets = parts.map(Number);
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    if (octets[0] === 0) return true;
    if (octets[0] === 169 && octets[1] === 254) return true;
  }
  return false;
}

const hostCache = new Map();

async function resolveAddresses(hostname) {
  const bare = hostname.replace(/^\[|\]$/g, '');
  const cached = hostCache.get(bare);
  if (cached && Date.now() - cached.at < HOST_CACHE_MS) return cached;
  let addresses;
  try {
    addresses = (await dns.lookup(bare, { all: true })).map((entry) => entry.address);
  } catch (error) {
    return { error: `cannot resolve ${bare}: ${error.code || error.message}` };
  }
  if (addresses.length === 0) return { error: `cannot resolve ${bare}` };
  hostCache.set(bare, { addresses, at: Date.now() });
  return { addresses };
}

async function checkUpstreamTarget(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `unsupported upstream scheme ${url.protocol}` };
  }
  if (env.allowRemote && url.protocol !== 'https:') {
    return { ok: false, reason: 'AURA_ALLOW_REMOTE=1 permits https upstreams only' };
  }
  const resolved = await resolveAddresses(url.hostname);
  if (resolved.error) return { ok: false, reason: resolved.error };
  if (env.allowRemote) {
    const blocked = resolved.addresses.find(isNeverAllowedAddress);
    if (blocked) return { ok: false, reason: `upstream address ${blocked} is never allowed` };
    return { ok: true };
  }
  const remote = resolved.addresses.find((address) => !isLoopbackAddress(address));
  if (remote) {
    return {
      ok: false,
      reason: `upstream ${url.hostname} resolves to non-loopback ${remote}; set AURA_ALLOW_REMOTE=1 to allow https upstreams`,
    };
  }
  return { ok: true };
}

function looksLikeChatModel(id, details) {
  if (details && Number(details.embedding_length) > 0) return false;
  return !EMBED_HINT.test(String(id));
}

function joinUpstream(base, pathPart) {
  const url = new URL(base);
  const basePath = url.pathname.replace(/\/+$/, '');
  const tail = pathPart.replace(/^\/+/, '');
  url.pathname = tail ? `${basePath}/${tail}` : basePath || '/';
  url.hash = '';
  return url;
}

function sendJson(res, status, payload, extraHeaders) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-accel-buffering': 'no',
    'content-length': Buffer.byteLength(text),
    ...extraHeaders,
  });
  res.end(text);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const settle = (fn, value) => { if (!settled) { settled = true; fn(value); } };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        const error = new Error('request body exceeds the bridge limit');
        error.code = 'BODY_TOO_LARGE';
        settle(reject, error);
        req.resume();
        if (size > limit * 4) req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => settle(resolve, Buffer.concat(chunks)));
    req.on('error', (error) => settle(reject, error));
  });
}

function fiscalYearFor(date, startMonth) {
  const year = date.getUTCFullYear();
  const startYear = date.getUTCMonth() + 1 >= startMonth ? year : year - 1;
  const endExclusive = new Date(Date.UTC(startYear, startMonth - 1 + 12, 1));
  const endDate = new Date(endExclusive.getTime() - 86400000);
  return {
    startMonth,
    label: `${startYear}-${startYear + 1}`,
    startDate: isoDate(new Date(Date.UTC(startYear, startMonth - 1, 1))),
    endDate: isoDate(endDate),
  };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function isoDate(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function mcpAuthorization() {
  if (!env.frappeKey || !env.frappeSecret) return null;
  return `token ${env.frappeKey}:${env.frappeSecret}`;
}

function providerSpecs() {
  return {
    llm: {
      prefix: '/proxy/llm',
      base: env.openaiBase,
      // Both LLM bases have defaults, so a truthiness test on the base can never fail. Without this
      // predicate an unconfigured OpenAI route reports the loopback guard instead of naming the key.
      configured: () => Boolean(env.openaiKey),
      notConfigured: 'set OPENAI_API_KEY (and OPENAI_BASE_URL / OPENAI_MODEL if not using OpenAI)',
      authorization: () => (env.openaiKey ? `Bearer ${env.openaiKey}` : null),
      extraHeaders: () => ({}),
      relaySession: false,
    },
    ollama: {
      prefix: '/proxy/ollama',
      base: env.ollamaUrl,
      configured: () => true,
      notConfigured: 'set OLLAMA_URL',
      authorization: () => null,
      extraHeaders: () => ({}),
      relaySession: false,
    },
    mcp: {
      prefix: '/proxy/mcp',
      base: env.mcpUrl,
      configured: () => Boolean(env.frappeKey && env.frappeSecret),
      notConfigured: 'set AURA_MCP_URL and FRAPPE_API_KEY / FRAPPE_API_SECRET',
      authorization: mcpAuthorization,
      extraHeaders: () => (env.mcpSite ? { 'x-frappe-site': env.mcpSite } : {}),
      relaySession: true,
    },
  };
}

async function handleProxy(req, res, spec, requestUrl) {
  const meter = { bytes: 0 };
  const rest = requestUrl.slice(spec.prefix.length);
  const queryAt = rest.indexOf('?');
  const pathPart = queryAt === -1 ? rest : rest.slice(0, queryAt);
  const search = queryAt === -1 ? '' : rest.slice(queryAt);

  if (!spec.configured()) {
    return sendJson(res, 503, { error: 'not_configured', hint: spec.notConfigured });
  }

  let target;
  try {
    target = joinUpstream(spec.base, pathPart);
  } catch {
    return sendJson(res, 400, { error: 'invalid_upstream_url' });
  }
  target.search = search;

  const verdict = await checkUpstreamTarget(target);
  if (!verdict.ok) {
    return sendJson(res, 400, { error: 'upstream_not_allowed', detail: verdict.reason });
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  let body = Buffer.alloc(0);
  if (hasBody) {
    try {
      body = await readBody(req, MAX_BODY_BYTES);
    } catch (error) {
      if (error.code === 'BODY_TOO_LARGE') {
        return sendJson(res, 413, { error: 'body_too_large', limitBytes: MAX_BODY_BYTES }, { connection: 'close' });
      }
      throw error;
    }
  }

  const headers = { ...spec.extraHeaders() };
  const authorization = spec.authorization();
  if (authorization) headers.authorization = authorization;
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  if (req.headers.accept) headers.accept = req.headers.accept;
  if (spec.relaySession) {
    if (req.headers['mcp-session-id']) headers['mcp-session-id'] = req.headers['mcp-session-id'];
    if (req.headers['mcp-protocol-version']) headers['mcp-protocol-version'] = req.headers['mcp-protocol-version'];
  }
  if (hasBody) headers['content-length'] = String(body.length);

  const controller = new AbortController();
  const stop = () => { if (!res.writableEnded) controller.abort(); };
  req.on('aborted', stop);
  res.on('close', stop);

  let upstream;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? body : undefined,
      signal: controller.signal,
      redirect: 'manual',
    });
  } catch (error) {
    if (controller.signal.aborted) { res.destroy(); return; }
    return sendJson(res, 502, {
      error: 'upstream_unreachable',
      detail: error.code || error.message,
    });
  }

  const outHeaders = { 'cache-control': 'no-store', 'x-accel-buffering': 'no' };
  const contentType = upstream.headers.get('content-type');
  if (contentType) outHeaders['content-type'] = contentType;
  if (spec.relaySession) {
    const sid = upstream.headers.get('mcp-session-id');
    if (sid) outHeaders['mcp-session-id'] = sid;
    const version = upstream.headers.get('mcp-protocol-version');
    if (version) outHeaders['mcp-protocol-version'] = version;
  }
  res.writeHead(upstream.status, outHeaders);
  if (upstream.status === 204 || upstream.status === 304 || req.method === 'HEAD') {
    res.end();
    return;
  }

  try {
    await pumpUpstream(upstream, res, controller, meter);
  } catch (error) {
    if (controller.signal.aborted) { res.destroy(); return; }
    res.destroy(error);
  }
}

async function pumpUpstream(upstream, res, controller, meter) {
  res.flushHeaders?.();
  if (!upstream.body) { res.end(); return; }
  const reader = upstream.body.getReader();
  try {
    for (; ;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const chunk = Buffer.from(value);
      meter.bytes += chunk.length;
      if (!res.write(chunk)) await once(res, 'drain');
    }
    res.end();
  } catch (error) {
    await reader.cancel().catch(() => { });
    if (controller.signal.aborted) { res.destroy(); return; }
    res.destroy(error);
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: 'manual' });
  } finally {
    clearTimeout(timer);
  }
}

async function probeOpenAi() {
  // Key, not base URL: the base has a default, so testing it would report a configured OpenAI provider
  // on a box with no key, and /api/config would then contradict /api/health.
  if (!env.openaiKey) return { configured: false, reachable: false, chatModels: [] };
  const spec = providerSpecs().llm;
  const target = joinUpstream(env.openaiBase, '/models');
  const verdict = await checkUpstreamTarget(target);
  if (!verdict.ok) return { configured: true, reachable: false, chatModels: [], error: verdict.reason };
  const headers = { accept: 'application/json' };
  const authorization = spec.authorization();
  if (authorization) headers.authorization = authorization;
  try {
    const response = await fetchWithTimeout(target, { headers }, HEALTH_TIMEOUT_MS);
    if (!response.ok) return { configured: true, reachable: false, chatModels: [], status: response.status };
    const payload = await response.json();
    const list = Array.isArray(payload?.data) ? payload.data : [];
    const models = [...new Set(list.map((m) => String(m?.id || '')).filter(Boolean))]
      .filter((id) => looksLikeChatModel(id))
      .sort();
    return { configured: true, reachable: true, chatModels: models };
  } catch (error) {
    return { configured: true, reachable: false, chatModels: [], error: error.code || error.message };
  }
}

async function probeOllama() {
  if (!env.ollamaUrl) return { configured: false, reachable: false, chatModels: [] };
  const target = joinUpstream(env.ollamaUrl, '/api/tags');
  const verdict = await checkUpstreamTarget(target);
  if (!verdict.ok) return { configured: true, reachable: false, chatModels: [], error: verdict.reason };
  try {
    const response = await fetchWithTimeout(target, { headers: { accept: 'application/json' } }, HEALTH_TIMEOUT_MS);
    if (!response.ok) return { configured: true, reachable: false, chatModels: [], status: response.status };
    const payload = await response.json();
    const list = Array.isArray(payload?.models) ? payload.models : [];
    const models = [...new Set(list.map((m) => String(m?.name || m?.model || '')).filter(Boolean))]
      .filter((name) => looksLikeChatModel(name, list.find((m) => (m.name || m.model) === name)?.details))
      .sort();
    return { configured: true, reachable: true, chatModels: models };
  } catch (error) {
    return { configured: true, reachable: false, chatModels: [], error: error.code || error.message };
  }
}

async function probeMcp() {
  if (!env.mcpUrl) return { configured: false, reachable: false };
  const target = joinUpstream(env.mcpUrl, '');
  const verdict = await checkUpstreamTarget(target);
  if (!verdict.ok) return { configured: true, reachable: false, error: verdict.reason };
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  const authorization = mcpAuthorization();
  if (authorization) headers.authorization = authorization;
  if (env.mcpSite) headers['x-frappe-site'] = env.mcpSite;
  try {
    const response = await fetchWithTimeout(
      target,
      { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'ping' }) },
      HEALTH_TIMEOUT_MS,
    );
    await response.arrayBuffer().catch(() => { });
    return { configured: true, reachable: true, status: response.status };
  } catch (error) {
    return { configured: true, reachable: false, error: error.code || error.message };
  }
}

async function handleHealth() {
  const [openai, ollama, mcp] = await Promise.all([probeOpenAi(), probeOllama(), probeMcp()]);
  return { ok: true, providers: { openai, ollama }, mcp };
}

function handleConfig() {
  const now = new Date();
  return {
    today: isoDate(now),
    site: env.mcpSite || null,
    fiscalYear: fiscalYearFor(now, env.fiscalYearStartMonth),
    allowRemote: env.allowRemote,
    providers: {
      openai: {
        id: 'openai',
        label: 'OpenAI',
        transport: 'chat-completions',
        baseUrl: '/proxy/llm',
        requestPath: '/chat/completions',
        upstream: env.openaiBase,
        modelId: env.openaiModel || null,
        configured: Boolean(env.openaiKey),
        envHint: ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL'],
      },
      ollama: {
        id: 'ollama',
        label: 'Ollama',
        transport: 'ollama-chat',
        baseUrl: '/proxy/ollama',
        requestPath: '/api/chat',
        upstream: env.ollamaUrl,
        modelId: env.ollamaModel || null,
        configured: true,
        envHint: ['OLLAMA_URL', 'OLLAMA_MODEL'],
      },
      demo: {
        id: 'demo',
        label: 'Demo (no backend)',
        transport: 'mock',
        baseUrl: null,
        upstream: null,
        modelId: 'demo',
        configured: true,
        envHint: [],
        models: [{ id: 'demo', label: 'Local preview' }],
      },
    },
    mcp: {
      baseUrl: '/proxy/mcp',
      upstream: env.mcpUrl || null,
      configured: Boolean(env.frappeKey && env.frappeSecret),
      siteHeaderSent: Boolean(env.mcpSite),
      envHint: ['AURA_MCP_URL', 'FRAPPE_API_KEY', 'FRAPPE_API_SECRET', 'AURA_MCP_SITE'],
    },
  };
}

async function handlePage(req, res) {
  let source;
  try {
    source = await readFile(PAGE_PATH);
  } catch (error) {
    return sendJson(res, 500, { error: 'page_unreadable', detail: error.code || error.message });
  }
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': source.length,
  });
  res.end(req.method === 'HEAD' ? undefined : source);
}

function countResponseBytes(res) {
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  res.outBytes = 0;
  res.write = (chunk, ...rest) => {
    if (chunk) res.outBytes += Buffer.byteLength(typeof chunk === 'string' ? chunk : chunk);
    return originalWrite(chunk, ...rest);
  };
  res.end = (chunk, ...rest) => {
    if (chunk && typeof chunk !== 'function') res.outBytes += Buffer.byteLength(typeof chunk === 'string' ? chunk : chunk);
    return originalEnd(chunk, ...rest);
  };
}

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  const requestUrl = req.url || '/';
  const pathPart = requestUrl.split('?')[0];
  countResponseBytes(res);
  res.on('finish', () => {
    process.stdout.write(`${req.method} ${pathPart} ${res.statusCode} ${Date.now() - startedAt}ms ${res.outBytes}b\n`);
  });
  try {
    if (pathPart === '/' && (req.method === 'GET' || req.method === 'HEAD')) {
      await handlePage(req, res);
    } else if (pathPart === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, await handleHealth());
    } else if (pathPart === '/api/config' && req.method === 'GET') {
      sendJson(res, 200, handleConfig());
    } else {
      const specs = providerSpecs();
      const match = Object.keys(specs).find((key) => pathPart === specs[key].prefix || pathPart.startsWith(`${specs[key].prefix}/`));
      if (match) {
        await handleProxy(req, res, specs[match], requestUrl);
      } else {
        sendJson(res, 404, { error: 'not_found' });
      }
    }
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
    } else {
      sendJson(res, 500, { error: 'bridge_error', detail: error.code || error.message });
    }
  }
});

server.on('clientError', (error, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n');
});

server.listen(env.port, env.host, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : env.port;
  process.stdout.write(`aura-bridge listening on http://${env.host}:${port}\n`);
  process.stdout.write(`aura-bridge openai=${env.openaiKey ? 'configured' : 'unset'} ollama=${env.ollamaUrl} mcp=${env.mcpUrl || 'unset'} allowRemote=${env.allowRemote}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
