# Aura Bridge

`code.html` is a single-file, no-build dashboard that is also a real ERPNext agent: it streams from
OpenAI or Ollama, calls `erpnext-mcp` tools, and gates every write behind a confirmation dialog.

`aura-server.mjs` is the local Node bridge that makes that possible. It serves `code.html`, injects
credentials that must never reach the page, and streams the three upstreams without buffering.

```bash
npm start          # http://127.0.0.1:8790
```

No dependencies. Node >= 18. Nothing is installed, compiled, or bundled.

## Why a bridge is not optional

Two of the three upstreams are unreachable from a browser page opened with `file://`, and one of them
is unreachable from the page even when it is served over HTTP:

- **erpnext-mcp sends no CORS headers.** A `file://` page has origin `null` and cannot call it at all.
- **A static HTML file must not contain an OpenAI key.** Anything committed to the page is public.
- **Ollama is the only component that is cross-origin reachable**, and only because it is started with
  `OLLAMA_ORIGINS=*`. Aura never relies on that; it goes through the bridge like everything else.

Open `code.html` directly and it still works: the page detects `file://`, selects the `Demo (no
backend)` provider, shows a persistent offline banner, and issues no network request at all. Real
providers and the tool timeline require the bridge.

## Environment

Every secret is read from the bridge's environment. The page never sees a key, and `/api/config`
returns only non-secret values.

| Variable | Default | What it does |
| --- | --- | --- |
| `AURA_HOST` | `127.0.0.1` | Bridge bind address. |
| `AURA_PORT` | `8790` | Bridge port. |
| `OPENAI_API_KEY` | unset | Sent upstream as `Authorization: Bearer`. OpenAI is reported unconfigured without it. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible base. Point at any Chat Completions server. |
| `OPENAI_MODEL` | unset | Fallback model id when model discovery fails. |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama base. |
| `OLLAMA_MODEL` | unset | Fallback model id when `/api/tags` yields no chat model. |
| `AURA_MCP_URL` | unset | MCP endpoint. The gateway is `http://127.0.0.1:8022/mcp`; raw erpnext-mcp is `http://127.0.0.1:8011/mcp`. |
| `AURA_MCP_SITE` | unset | Sent as `X-Frappe-Site` **only when non-empty**. Leave it unset to use the gateway's own default site — sending a mismatched site is a 401. |
| `FRAPPE_API_KEY` | unset | Sent as `Authorization: token <key>:<secret>`. |
| `FRAPPE_API_SECRET` | unset | As above. |
| `AURA_FISCAL_YEAR_START_MONTH` | `4` | Computes the fiscal year sent in the runtime system block. |
| `AURA_ALLOW_REMOTE` | unset | `1` permits https upstreams outside loopback. Read the guard note below first. |

## Pointing at raw erpnext-mcp instead of the gateway

The gateway on `8022` is the recommended target. It adds RBAC, field redaction, MRTR idempotency, and
its own approval gates, and it is the only target that reports tiers.

```bash
AURA_MCP_URL=http://127.0.0.1:8022/mcp npm start     # gateway: tiers, RBAC, audit
AURA_MCP_URL=http://127.0.0.1:8011/mcp npm start     # raw server: no tiers, no approval
```

Against raw `erpnext-mcp` there is no `get_tool_manifest`, so every tool reads as tier `unknown`, the
MCP drawer shows a single untiered group, and **every tool call opens the approval dialog**. That is the
fail-closed rule working, not a bug.

## Writes are gated twice

A `write`, `customize`, `administer`, or `execute` tool — and any tool whose tier is unknown — opens a
confirmation dialog showing the exact arguments before the call leaves the browser. Approve, Reject,
Escape-as-Reject, or "allow `<tool>` for this conversation". The gateway applies its own gate for
`execute` and `administer` on top of that, which surfaces as a `blocked` row rather than an error.

Three additional rules hold regardless of what a model asks for:

- `call_tool` and 15 other gateway-reserved names are never offered to a model, and are refused again at
  execution time if a model hallucinates one. `call_tool` is a generic escape hatch, so a tier lookup on
  it reads "unknown" while the call it performs can be a delete.
- An unknown tier always fails closed to approval. A manifest that never loaded is not a bypass.
- Mutating tools are sent with a caller-supplied `request_id`, stable across a transport retry, so a
  retry after an indeterminate outcome cannot double-apply.

## Upstream guard

Upstreams must resolve to loopback. Setting `AURA_ALLOW_REMOTE=1` relaxes this to https only, and even
then `0.0.0.0/8`, `169.254/16`, `::`, `::1`, and IPv4-mapped forms stay blocked. Base URLs come from the
environment only and the page cannot override them, so there is no SSRF surface from the page. Request
bodies are capped at 4 MB.

The bridge logs one line per request — method, path, status, duration, bytes — and never a body, a
header, or a key.

## Validating

```bash
node validate-aura.mjs                  # static: syntax, duplicate ids, API ban, no-secret check
node validate-aura.mjs --browser        # 16 browser groups against a deterministic fake
AURA_LIVE=1 node validate-live.mjs      # opt-in: real gateway, real model
```

`--browser` starts its own fake upstream and bridge on free ports and kills them afterwards; it never
touches your running services. The fake serves OpenAI SSE, Ollama NDJSON, and MCP JSON-RPC, and logs
every call so the harness can assert that no `tools/call` leaves the browser before consent. Set
`AURA_CHROMIUM_PATH` to use a specific Chrome build if Playwright's own download is unavailable.

`validate-live.mjs` is opt-in because a real exchange costs tokens. It prints provider, model, site,
tool count, and tier counts, and it refuses to exit successfully if anything resembling a credential
reaches its output. Point it at a running bridge with `AURA_LIVE_URL`, or let it start its own.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `401 Invalid api_key or api_secret` from the gateway | The pair is wrong or `AURA_MCP_SITE` is set to a site the key does not belong to. Sending a mismatched `X-Frappe-Site` fails the same way as a bad key. Unset it to use the gateway's default. |
| Row shows `blocked`, nothing changed | The gateway's own gate refused the call. Common for `execute` and `administer`. This is the second gate, working. |
| `tools/list` returns 0 tools | The key authenticated but its RBAC profile allows nothing. The manifest still reports the full catalogue, so the drawer shows the gap rather than pretending the server is empty. |
| Ollama row says "no chat model installed" | `GET /api/tags` returned only embedding models. Pull one: `ollama pull llama3.2`. Aura never auto-pulls. |
| Ollama replies `404 model not found` | The fallback model id no longer exists. Discovery failed earlier, so check the Models section in settings. |
| Ollama replies `503` then works | Normal. Ollama returns 503 while a model loads into memory. Aura retries once after 1s on the opening request of an exchange. |
| Local Ollama model replies `400 … does not support tools` | The model cannot do tool calling. Use a tool-capable model, or select OpenAI. Tool calling against local models is not available on this machine — see below. |
| Anything fails only when opened with `file://` | Expected. `file://` selects the Demo provider and issues no requests. Use `npm start`. |
| `upstream … resolves to non-loopback` | The guard, not a bug. A remote upstream needs `AURA_ALLOW_REMOTE=1` and an https URL. |
| Assistant claims a change succeeded when it did not | Should be impossible: rows carry the server's own `status`, and the system prompt forbids claiming success a tool did not report. If you see it, the result envelope is not what this README describes — check `window.aura.toolRuns()`. |

## Known limitations

- **Local Ollama models on this machine do not support tool calling.** The only chat models present are
  `smollm2:135m` (`400 … does not support tools`) and `sysverify-26226` (`400 … does not support chat`);
  every tool-capable model is a `:cloud` tag that needs an Ollama auth key. Streaming and the error
  path are verified against real Ollama; tool calling is covered by the fake only.
- **Ollama tool calling is not the same shape as OpenAI's.** Ollama sends `arguments` as an object and
  OpenAI as a JSON string, and Ollama has no `tool_call_id`. The page normalizes both into one event
  shape, so the agent loop never branches on transport — but a provider that diverges further will
  need a third adapter.
- **Anthropic-protocol providers will not work.** `agentrouter.org` speaks the Anthropic Messages API,
  which the Chat Completions adapter cannot drive. There is deliberately no third adapter.
- **The gateway retires an MCP session after every `tools/call`.** Aura re-initializes lazily and
  replays once, so it is invisible in the UI, but it means each tool call costs an extra round trip.
- **Nothing persists.** Conversations, staged files, and per-conversation tool grants live in memory
  and reset on refresh. File attachments are metadata only.

## Reading more out of the page

`window.aura` is a frozen diagnostics surface: `state`, `providers`, `shortlist(text)`,
`scoreTool(name, text)`, `shortlistNames()`, `toolRuns()`, `messages()`, `upstream()`, `budget(text)`,
`retriever`, plus `setProvider`, `applyShortlist`, `expandShortlist`, `refreshBridge`, `retryMcp`,
`resolveApproval`, `newChat`, and `stop`. It holds no secret and is what the harness asserts against.
