# Real AI chat: OpenAI + Ollama providers, erpnext-mcp tool calling, write-tool approval

## Context

`code.html` is a single-file, no-build, browser-openable Aura dashboard (9211 lines). All its JS is one
IIFE, lines 6869-9208. Nothing touches the network today: no `fetch`, no `AbortController`, no storage.
Chat is simulated by `queueMockResponse` (8569) -> `makeAssistantMessage` (8257) -> an 18ms-per-character
fake stream `streamResponse` (8543), driven by five keyword regexes in `getResponseProfile` (8175-8255).
Models are three hardcoded Claude buttons duplicated in the popover (6853-6864) and settings drawer
(6614-6618); `state.activeModel` holds a display *string*, not an id. MCP is a local catalog literal
(7122-7127); `useMcpTool` (7221-7227) only closes the drawer and toasts.

Real services already run: `erpnext-mcp` with **507 tools** on `127.0.0.1:8011/mcp`, and
`erpnext-mcp-gateway` (RBAC, MRTR idempotency, approval gates, field redaction, audit) on
`127.0.0.1:8022/mcp`. A working Frappe `api_key`/`api_secret` pair exists in `/home/frappe/opencode.json`.
Ollama runs on `11434` with `OLLAMA_ORIGINS=*`. Neither MCP endpoint sends CORS headers, so a `file://`
page (origin `null`) cannot reach them, and a static HTML file must not hold an OpenAI key.

## Verified facts this plan depends on

Read from source, not assumed.

**MCP wire contract** — from the gateway's own working client,
`/home/frappe/erpnext-mcp-gateway/scripts/check_bridge_drift.py:62-97`:

- `POST` with `Content-Type: application/json`, `Accept: application/json, text/event-stream`.
  Browser->gateway auth is `Authorization: token <api_key>:<api_secret>` + `X-Frappe-Site`.
- Response parsed by `re.search(r"^data: (.*)$", raw, re.M)` **with a raw-body fallback** — the server may
  answer SSE or a single JSON object. `Mcp-Session-Id` arrives on `initialize`, is replayed on later calls,
  and **may be absent** (`_fake_backend.py` omits it).
- `initialize` accepts `protocolVersion: "2024-11-05"`; the version is negotiated, so send a recent one and
  adopt what the server returns.
- `tools/list` -> `result.tools[]` of `{name, description, inputSchema}`; paginate on `nextCursor`.
- `tools/call` -> `result.content[].text` with **JSON encoded inside the text**, plus `isError`.

**Tool tiers** — `tools/call get_tool_manifest` returns `{"data":{"tiers":{"get_doc":"read",...}}}`
(`_fake_backend.py:59-60`). Tiers are `read | write | customize | administer | execute`, counts
226/120/105/45/11. Drawer grouping and approval gating read this tool, never the descriptions.

**Gateway-reserved meta tools** — `check_bridge_drift.py:116-134` lists names the gateway implements
natively alongside the backend: `call_tool`, `search_tools`, `schema`, `get_tool_schema`, `health`,
`gateway_status`, `get_gateway_status`, `gateway_audit_report`, `gateway_audit`, `mrtr_status`,
`create_client`, `revoke_client`, `list_clients`, `reload_rbac`, `rebuild_index`. See 2.6 — `call_tool`
in particular is a hole.

**A reference fake backend already exists** — `/home/frappe/erpnext-mcp-gateway/scripts/_fake_backend.py`
(POST-only `/mcp`, plain-JSON, no SSE, no session id, 2 tools). `test-support/fake-upstream.mjs` mirrors
this exact response shape so divergence from a known-good implementation is a test failure.

## Decisions (agreed)

| # | Decision |
| --- | --- |
| 1 | **Local Node bridge in this repo** (`aura-server.mjs`). Not Frappe endpoints, not pure client-side. |
| 2 | **MCP target is the gateway on `127.0.0.1:8022`**, overridable via `AURA_MCP_URL`. |
| 3 | **OpenAI via Chat Completions** `POST {base}/v1/chat/completions`, `stream:true`, SSE, `tools:[{type:'function'}]`. |
| 4 | **Ollama via native `POST {OLLAMA_URL}/api/chat`**, streaming NDJSON. A second parser. |
| 5 | **Secrets are env-only**, read from `AURA_*`/`OPENAI_*`/`OLLAMA_*`/`FRAPPE_*` vars. The bridge never reads `/home/frappe/opencode.json`; that file is another tool's config and coupling to it invites leaking its keys. `validate-aura.mjs:20`'s `innerHTML\|localStorage\|sessionStorage` ban stays intact. |
| 6 | **No bridge -> explicit `Demo (no backend)` provider** (the existing mock), auto-selected, with an offline banner. A real provider that *fails* errors loudly and never silently falls back. |
| 7 | **All 226 read-tier tools are reachable, delivered as a per-turn shortlist** built client-side from the full `tools/list` catalog. |
| 8 | **Write / customize / execute require a confirmation dialog** showing exact arguments before the call goes out. Approve, Reject, Escape-as-Reject, per-tool "allow for this conversation". |
| 9 | **Tool calls render as dedicated timeline rows between messages**, not inside the assistant bubble. |
| 10 | **System prompt is two parts**: a static persona block in `code.html`, plus a per-request runtime block the bridge injects (today's date, Frappe site, fiscal year, enabled tiers). |
| 11 | **Deterministic fake upstream for tests**, plus an opt-in `validate-live.mjs`. |

## Terminology (these were overloaded; fixed here)

- **Exchange** — one user prompt through to one final assistant bubble, including every tool row and every
  intermediate model iteration in between.
- **`state.messages`** — UI transcript of user/assistant prose bubbles. Existing.
- **`state.toolRuns`** — UI tool timeline rows, each with an `ownerId` naming the exchange it belongs to.
- **Upstream transcript** — never stored. Rebuilt on demand by `buildUpstreamMessages()` from `messages` +
  `toolRuns`. A second mutable copy alongside `messages` would desync across the five existing splice
  sites; deriving it removes that whole class of bug.

## Files

| File | Status | Purpose |
| --- | --- | --- |
| `aura-server.mjs` | new | Zero-dependency bridge: serve `code.html`, `/api/health`, `/api/config`, `/proxy/llm/*`, `/proxy/ollama/*`, `/proxy/mcp/*`. |
| `test-support/fake-upstream.mjs` | new | Deterministic OpenAI SSE, Ollama NDJSON, MCP JSON-RPC mirroring `_fake_backend.py`, with a call log. |
| `validate-live.mjs` | new | Opt-in smoke test against the real gateway and a real model. |
| `package.json` | new | `{"type":"module"}` + `start` / `validate` / `validate:browser`. No dependencies. |
| `code.html` | modify | Providers, MCP client, retriever, agent loop, approval dialog, timeline rows, system prompt. |
| `validate-aura.mjs` | modify | Serve over HTTP against the fake, replace hardcoded assertions, add tool/approval groups. |
| `README-AURA-BRIDGE.md` | new | Env table, run instructions, troubleshooting. |
| `.kilo/skills/aura-staging-dashboard/SKILL.md` | modify | Sections 6/7/8 and the "no backend, metadata-only" rules now contradict the product. |

## Part 1 — `aura-server.mjs`

Node >= 18, `node:http` + `node:fs` only.

```
AURA_PORT=8790   AURA_HOST=127.0.0.1
OPENAI_API_KEY=sk-...   OPENAI_BASE_URL=https://api.openai.com/v1   OPENAI_MODEL=gpt-4o-mini
OLLAMA_URL=http://127.0.0.1:11434   OLLAMA_MODEL=llama3.2
AURA_MCP_URL=http://127.0.0.1:8022/mcp   AURA_MCP_SITE=frappe.localhost
FRAPPE_API_KEY=...   FRAPPE_API_SECRET=...
AURA_FISCAL_YEAR_START_MONTH=4
```

| Route | Behaviour |
| --- | --- |
| `GET /` | `code.html`, `Cache-Control: no-store`. Every other path 404s — never serve the repo. |
| `GET /api/health` | `{ok, providers:{openai:{configured,reachable,chatModels}, ollama:{...}}, mcp:{configured,reachable}}`. 1500ms timeout, never throws, unset provider reports `configured:false`. |
| `GET /api/config` | Non-secret only: provider ids, base URLs, model ids, `site`, `today` (ISO date), `fiscalYear` (computed from `AURA_FISCAL_YEAR_START_MONTH`, default April). **Never** echoes a key. Feeds both model discovery and the runtime system block. |
| `ALL /proxy/llm/*` | Unbuffered passthrough to `$OPENAI_BASE_URL/*`, injecting `Authorization: Bearer $OPENAI_API_KEY` when set. |
| `ALL /proxy/ollama/*` | Unbuffered passthrough to `$OLLAMA_URL/*`, no auth header. |
| `ALL /proxy/mcp/*` | Unbuffered passthrough to `$AURA_MCP_URL/*`, injecting `Authorization: token $FRAPPE_API_KEY:$FRAPPE_API_SECRET` and `X-Frappe-Site`. Relays `Mcp-Session-Id` and `MCP-Protocol-Version` **both** directions. Also relays `DELETE` so the page can terminate a session. |

These are correctness requirements, not polish:

- **No buffering anywhere.** Pipe `req`->upstream and upstream->`res`; set `X-Accel-Buffering: no`. A
  buffered proxy turns a token stream into a hang.
- **Abort upstream when the client socket closes**, per-request `AbortController`. Otherwise Stop leaves a
  provider stream and an MCP session alive. Asserted in the harness.
- **Base URLs are env-only and never overridable by the page.** Dropping the earlier
  `/api/runtime-config` idea removes the SSRF surface entirely; model id, temperature, max tokens, and tool
  scope are per-request body fields. The bridge holds no mutable state.
- Reject upstreams resolving outside loopback unless `AURA_ALLOW_REMOTE=1`, and then https only, never
  169.254/0.0.0.0/::1. Cap bodies at 4 MB (413 past that). One log line per request — method, path, status,
  duration, bytes. Never bodies, headers, or keys.

## Part 2 — `code.html`

New code stays inside the existing IIFE: no ESM `import`, no top-level `await`, because
`validate-aura.mjs:14` runs `new vm.Script()` over every inline script as a classic script.

### 2.1 State (extend the object at 6887-6943)

```js
activeProvider: 'demo',
providers: {},        // id -> {id,label,transport,baseUrl,modelId,configured,reachable,models[]}
mcp: { status:'idle', error:'', toolCatalog:[], toolIndex:new Map(), tiers:{}, sessionId:null,
       protocolVersion:'2025-06-18', manifestLoaded:false, shortlistNames:[] },
toolRuns: [],        // {id, ownerId, index, name, tier, args, status, durationMs,
                      //  resultPreview, resultFull, error, requestFragment, requiresApproval}
aborts: new Map(),   // exchange id -> AbortController
approval: null,      // {rowId, toolName, args, resolve} while a dialog is open
grants: new Set(),   // tool names approved for this conversation
banner: null         // {kind, text}
```

Retire `activeModel` (6893) in favour of `activeProvider` + per-provider `modelId`; keep
`updateModelLabels()` (8059-8070) as the single writer of `[data-model-label]`.

### 2.2 System prompt (decision 10)

Two messages, prepended in `buildUpstreamMessages()`:

- **Static persona**, in `code.html`: role is an ERPNext operations assistant; answer from tool results,
  never from memory; never state an action succeeded unless the tool result said so; when a needed tool is
  unavailable, say so plainly and name what would unblock it; keep answers short and use Markdown.
- **Runtime block**, built from `GET /api/config` and the current tier grants: today's date, Frappe site,
  fiscal year, and the tiers currently permitted. This is what makes "sales last month" and "which fiscal
  year" resolvable instead of guessed. Sent as a second `system` message; if a provider rejects two system
  messages, merge them into one.

### 2.3 Providers and model discovery

Replace the duplicated hardcoded model buttons (6614-6618, 6853-6864) with a JS array, following the
`renderMcpServers` (7135) pattern:

```js
const providerCatalog = [
  { id:'openai', label:'OpenAI', transport:'chat-completions', baseUrl:'/proxy/llm',
    modelsFrom:'/proxy/llm/models' },
  { id:'ollama', label:'Ollama',  transport:'ollama-chat',      baseUrl:'/proxy/ollama',
    modelsFrom:'/proxy/ollama/api/tags' },
  { id:'demo',   label:'Demo (no backend)', transport:'mock', baseUrl:null,
    models:[{id:'demo',label:'Local preview'}] }
];
```

`GET /api/health` seeds `configured`/`reachable`. OpenAI models from `GET {base}/v1/models` (drop
embedding-shaped ids); Ollama from `GET /api/tags` filtered to chat models — the only model named anywhere
in this repo is the embedding model `nomic-embed-text`, and the model store under the `ollama` user is not
readable by `frappe`, so `/api/tags` is the **only** reliable inventory. On failure fall back to
`OPENAI_MODEL`/`OLLAMA_MODEL`; if that is also missing show one "no models discovered" row with Retry. When
`/api/tags` is reachable but yields zero chat models, say exactly that and name `ollama pull <model>`.
Never auto-pull.

**Gate every network call on `location.protocol === 'http:'` before issuing it.** On `file://` a relative
`/api/health` resolves to `file:///api/health` and Chromium logs a CORS console error, which breaks the
zero-console-error assertion at `validate-aura.mjs:222`. Check the protocol first, select `demo`, show the
banner, and attempt no fetch at all.

Boot at 9194-9207 gains fire-and-forget `bootstrapProviders()` and `connectMcp()`, each with a `.catch`
that only sets a banner. While `state.busy`, disable provider and model switching so a mid-stream change
cannot swap the adapter under a live request.

### 2.4 Streaming adapters

Two parsers, one normalized event shape, so the loop is provider-agnostic:

```js
{type:'text', delta}          {type:'reasoning', delta}     // Ollama thinking field only
{type:'tool_call', index, id, name, argumentsJson}
{type:'tool_call_delta', index, argumentsJson}
{type:'usage', promptTokens, completionTokens}
{type:'done', finishReason}   {type:'error', message, retryable}
```

- `streamChatCompletions` — SSE: split on `\n\n`, skip `:` comments and `[DONE]`, `JSON.parse` each `data:`
  line. `choices[0].delta.content`->`text`, `delta.tool_calls[]`->`tool_call`/`tool_call_delta`,
  `delta.reasoning_content`->`reasoning`, terminal `usage`->`usage`, `finish_reason`->`done`. A **residual
  buffer** must survive chunks that split mid-JSON.
- `streamOllamaChat` — NDJSON: split on `\n`, parse each complete line. `message.content`->`text`,
  `message.thinking`->`reasoning`, `message.tool_calls[]`->`tool_call`, `done_reason`->`done`,
  `prompt_eval_count`/`eval_count`->`usage`.
- Accumulate `argumentsJson` per tool-call index and `JSON.parse` **once**, at `done`. Malformed arguments
  yield an `error` event and a row showing the raw string. Never throw out of the stream loop.
- One automatic retry after 1s for HTTP 429/503 on the opening request of an exchange only, then a visible
  error. Ollama returns 503 while a model loads.

### 2.5 MCP client

`class McpClient`: `initialize()`, `listTools()`, `callTool(name,args)`, `close()`. Per the verified
contract: send `Mcp-Session-Id` once received and **tolerate its absence**; detect `content-type` and parse
SSE or single-JSON; loop `tools/list` on `nextCursor`; adopt the negotiated `protocolVersion`; 15s
per-request timeout. `close()` aborts in-flight requests **and sends `DELETE`** to release the session, so
the gateway does not accumulate one per page load. Do **not** open the server-to-client `GET /mcp` SSE
stream — POST-only is valid and avoids a second long-lived connection.

On connect, call `get_tool_manifest` and store `mcp.tiers` from `{"data":{"tiers":{...}}}`. This is the
single source of truth for drawer grouping and approval gating.

### 2.6 Tool retriever — shortlist from all 226, with the meta-tool hole closed

All 226 read tools are reachable; the request carries a per-turn shortlist so a 3B local model is not handed
40-60k tokens of schema.

Index each catalog tool on `name`, `description`, `inputSchema` property names, and `tier`. Score against
the latest user message: tokenise, drop stopwords, then +3 name match, +2 parameter-name match, +1
description match, +2 if the tier is currently permitted. Apply a small ERPNext expansion map (invoice ->
sales/purchase invoice, stock -> item/warehouse/bin, money -> amount/paid/outstanding, staff -> employee,
customer -> customer/contact, ...) — this domain vocabulary is where naive keyword scoring fails hardest.

**Exclusion list.** Never shortlist the gateway-reserved meta tools. `call_tool` in particular is a generic
escape hatch that would reach a write tool while the tier check reads `unknown` — the one place the
fail-closed rule in 2.7 would be the only thing standing between the model and an unapproved write. Also
exclude `search_tools`, `get_tool_schema`, `create_client`, `revoke_client`, `reload_rbac`,
`rebuild_index`, `mrtr_status`, and the `gateway_*` family. `search_tools` is excluded despite being
useful for discovery, because `recommend_tools` already covers that role through the backend.

Always-on core, never dropped: `get_doc`, `list_docs`, `get_doctype_meta`, `list_doctypes`,
`get_capabilities`, `recommend_tools`, `get_tool_manifest`. Fill the remainder to **24 total** by score.
Write/customize/administer/execute tools are shortlisted only when the user's own message implies intent to
change something — and the retriever must never be the thing that grants write capability, so a write-tier
tool is admitted only after 2.7 has opened and closed an approval flow.

**Miss handling.** If the model calls `recommend_tools`, resolve it to concrete names, and if any are absent
from the request, expand the shortlist and re-run the same exchange with a system note naming the newly
available tools. Cap at **2 expansions**.

### 2.7 Write-tool approval (decision 8)

New 7th overlay, following the drawer contract at 7088-7112 (`open*` sets the focus guard, `close*`
restores focus via `state.<x>Trigger`).

- Shown when a tool's tier is `write | customize | administer | execute`, **or when the tier is unknown**.
  Unknown-tier fails closed to approval; a manifest that never loaded must not become a bypass.
- Body: tool name, tier, target doctype, and the **exact pretty-printed arguments**. Buttons Approve and
  Reject, plus an "Allow `<tool>` for this conversation" checkbox.
- Resolve the promise in `state.approval`. Approve -> call proceeds. Reject -> feed
  `{"error":"Rejected by the user in Aura"}` back as the `role:'tool'` result so the model adapts, row
  `rejected`.
- **Escape rejects** and must be placed **above `state.busy`** in the keydown cascade at 9090-9102, so
  rejecting a pending call does not also abort the exchange.
- Aborting an exchange with a dialog open must resolve the gate as `rejected`, never leave it pending.
- Tier styling: `read` neutral, `write` tertiary `#943700`, `execute`/`administer` error `#ba1a1a` with a
  `warning` Material Symbol.
- Grants live in `state.grants`, in memory only, cleared by `startNewChat` (8140).
- The gateway applies its own gate for `execute`/`administer` regardless; surface `approval_required` as
  row status `blocked`, not as a generic error.

### 2.8 Agent loop

`async function runExchange(userMessage)` replaces the send path; `queueMockResponse` (8569) stays untouched
as the `demo` transport's implementation.

```
loop (max 6 iterations):
  1. tools = shortlistTools(latestUserText)            # 2.6
  2. body  = { model, messages: buildUpstreamMessages(), tools, tool_choice:'auto', stream:true, ... }
  3. stream via the active adapter; append text deltas to the assistant bubble (see 2.9)
  4. tool_call -> create a toolRuns row, status 'running', render
  5. at done: no tool_calls -> break
  6. for each call: if tier unknown or in {write,customize,administer,execute} -> await the dialog (2.7)
     then callTool(name, JSON.parse(args)); push the assistant tool-call fragment and the
     role:'tool' result; update the row to done | error | blocked | rejected + duration
  7. repeat
```

- Run the calls within one assistant message **in parallel, capped at 4**; rows have independent status
  anyway, and sequential is pure latency for independent ERPNext reads.
- One `AbortController` per exchange, stored in `aborts` keyed by exchange id. `stopResponse` (8562) and
  the Escape branch (9100) call `.abort()`; still-`running` rows become `cancelled`.
- A failed *tool* is recoverable — feed the error text back and let the model continue. A failed *request*
  ends the exchange and shows Retry on the bubble.
- **Result budget: 24 KB**, JSON-aware rather than a blind cut, because truncated JSON badly confuses a
  model. If the result parses, keep every key, cap arrays at 3 items and strings at 2000 chars, and append
  `{"_truncated":true,"_originalBytes":N}`. If it does not parse, hard-truncate at 24 KB with a visible
  marker. The untrimmed text stays on the row for display.

### 2.9 Rendering: timeline rows, and streaming without a full re-render

Rows render as `div.tool-run[data-tool-run-id][data-status]` between the user turn and the assistant bubble,
ordered by `index`. **The class is `.tool-run`, deliberately not `.message-row`**, so the existing
`.message-row` counts in `validate-aura.mjs` (62, 196, 209) keep meaning "prose turn".

- Row contents: status dot (`running` pulses, `done` check, `error` alert, `blocked` lock, `rejected`
  minus, `cancelled` minus), tool name in JetBrains Mono, tier badge when not `read`, a one-line arg summary
  (`Sales Invoice · SI-0001`; `Sales Invoice · 2 filters · limit 20`), duration, and a disclosure button.
- The disclosure renders the raw result **lazily on first expand** into a `pre.response-code`-styled block.
  Rendering a 200 KB `<pre>` on every re-render is a real jank source.
- `role="status"` + `aria-live="polite"` on the container so progress is announced.
- `renderTypingMessage` (8459) must also appear when tool rows exist but no text has arrived.

Two rules the fake stream made unnecessary but real streams do not:

1. `renderChatMessages` (8503) does a full `replaceChildren`. Re-running it at 60fps for a long thread
   destroys scroll position and focus. During streaming, patch **only** the active bubble's text node;
   full re-render on `done`, on tool-row transitions, and on error.
2. Coalesce deltas to one patch per `requestAnimationFrame`, never per delta.

`renderAssistantContent` (8344) drops the `sources` and `code` blocks for real providers — a model does not
emit those structures — and keeps them for `demo`. `.response-meta` (8386) gains
`N tools · X.Xs · Y tokens` from the real `usage`. The static "Local prototype response" label at 8433
becomes provider-aware.

Splice rules, all of which must change together or rows desync:

| Function | Change |
| --- | --- |
| `saveEditedMessage` | drop `toolRuns` owned by exchanges at/after the branch point |
| `regenerateMessage` (8765) | drop that exchange's rows, then re-run |
| `startNewChat` (8140) | clear `toolRuns`, `aborts`, `approval`, `grants` |
| `resumeSession` / `saveActiveSession` | persist `toolRuns` alongside `messages` |
| `seedSessions` (7967) | seed 1-2 completed tool rows so the timeline is visible on first load — the `demo` transport itself stays frozen and never fabricates tool activity |

### 2.10 MCP drawer becomes real

- Delete `mcpServerCatalog` (7122-7127). `mcp.toolCatalog` replaces it, **grouped by tier from
  `mcp.tiers`**, with counts per group.
- The hardcoded overview copy at 6640 ("4 local connections", "Live") and heading/description at 6644
  ("Filesystem", "Read-only workspace context for local documents.") become live values from `mcp.status`.
- Statuses: `connecting`, `ready` (tool count), `error` (`mcp.error` + Retry), `unsupported`.
- **Show the live shortlist.** Each tool row carries a "in this turn" badge when it is in the current
  24-tool shortlist, and the header shows `N of M tools in this turn's context`. Without this the user
  cannot tell whether a "it can't see my invoices" answer is a real limit, and the assistant's capability
  becomes unknowable from the UI.
- `useMcpTool` (7221) closes the drawer, switches to chat, prefills the composer with `Use the <tool> tool
  to `. It must **not** auto-execute — an implicit ERP query from a button click is not predictable.
  Disabled for tools outside the active shortlist, with a hint on how to widen.
- Sidebar integration row (6709-6713) and composer footer button (6770) read counts from `mcp`, not `4`.
- Add arrow-key navigation and Enter/Space to `#mcp-search-input` (currently input-only at 9071-9074),
  matching `#search-modal-input` (9041-9069), which the skill requires for this drawer.

### 2.11 Settings drawer gains a Providers section

Insert after Active model (6612-6619), following the `section.settings-section` pattern at 6598-6628:
per-provider status (dot, label, base URL, discovered model count, last-checked) and a connection log of the
last bridge request, so a gateway 401 is diagnosable without devtools. Non-configured providers get a muted
hint naming the exact env var. Model id, temperature, and max tokens are per-request fields.

Three concrete traps to fix here:

- **The settings Tab trap at 9122 selects only `'.settings-dialog button:not([disabled])'`.** Any new input
  falls outside it. Widen to
  `'.settings-dialog button:not([disabled]), .settings-dialog input:not([disabled]), .settings-dialog select:not([disabled]), .settings-dialog textarea:not([disabled])'`,
  matching the MCP trap at 9135 which already includes `input`.
- The approval dialog needs its own Tab trap and focus return, and must be added to `closeMenus()`
  (8703-8711) and the close-all block in `startNewChat` (8155-8160).
- The **global click listener at 8953-8967** closes each open drawer on outside click. The approval dialog
  must be added there, or clicking its backdrop behaves inconsistently with the other six overlays.

Footer copy at 6629 changes from "settings are local preview state" to state that keys live in the bridge
environment and are never sent to the page. `handleAction` (8813) gains `select-provider`,
`retry-provider-check`, `retry-mcp`, `approve-write`, `reject-write`, `toggle-tool-grant`.
`preferences.mcpSync` (6941) is repurposed from a decorative toggle to "auto-connect MCP on load".

### 2.12 Degraded states

- Boot with no reachable bridge, or `location.protocol !== 'http:'`, selects `demo` and shows a persistent
  strip above the thread: "Offline preview - responses are generated in this tab. Start `aura-server.mjs`
  and open http://127.0.0.1:8790 for real providers and erpnext-mcp."
- Copy at 6846 ("Prototype responses are generated locally in this tab...") becomes provider-aware.
- A real provider that is selected and then fails shows an error bubble with Retry. It must **not** switch
  to `demo`.
- `preferences.streaming` (6941) stays a real toggle: off means one `stream:false` request awaited to
  completion with the typing indicator held for the whole duration.
- Selecting `demo` while a real provider works is allowed and explicit; the banner explains why.

## Part 3 — `validate-aura.mjs`

Line numbers are current-file. `createRequire` at line 7 is already correct, so Playwright loading works.

1. **Keep** line 20. Decision 5 means nothing needs it.
2. **Add** a static check that `code.html` contains no `Authorization:` literal and no `sk-` prefix, so a
   pasted key can never be committed.
3. **Replace** the `file://` navigation: spawn `aura-server.mjs` as a child with `AURA_MCP_URL` and both
   LLM base URLs pointed at `test-support/fake-upstream.mjs`, wait for `GET /api/health`, navigate to
   `http://127.0.0.1:<port>/`. Keep the existing `file://` pass as a second page asserting only the
   degraded/`demo` path, and fix the hardcoded `file://${sourcePath}` at 230. Always kill the child in a
   `finally`.
4. **Delete** the model assertion at 121-122 (hardcodes `data-model="Claude 3.7 Opus"`); assert the fake
   provider's discovered model id instead.
5. **Replace** the MCP counts at 137-138 (4 servers / 2 tools) and the heading at 140 (`'GitHub'`) with
   catalog-derived expectations, gated on `mcp.status === 'ready'`.
6. **Replace** the timing-based mock assertions at 164-168 (`waitForTimeout(2600)`, then `.response-code` /
   `.message-rich h2` / `.source-chip`) with `waitForSelector` on the finished bubble. Keep the
   `.typing-bubble` assertion but make it awaited, not a sleep.
7. **Add — retriever.** With a scripted catalog of 226 read tools, assert the outbound request body carries
   at most 24 tools, always contains the 7-tool core, excludes `call_tool`, and that a "sales invoice" prompt
   ranks `get_doc` above `get_employee`.
8. **Add — tool row.** Scripted tool call: `.tool-run[data-status=running]` appears, transitions to
   `[data-status=done]`, shows the tool name and the `2 filters` arg summary, the disclosure expands, and
   `.response-meta` contains `1 tool`.
9. **Add — tool error and recovery.** Scripted `isError` -> `[data-status=error]`, the exchange continues,
   final text present.
10. **Add — approval, the security-critical group.** A scripted `write`-tier call must assert: the dialog
    opens; **no `tools/call` reaches the fake MCP upstream before Approve** (the fake logs every call, which
    is what makes this checkable); Reject and Escape both yield `[data-status=rejected]`; Approve yields
    `[data-status=done]`; "allow for this conversation" suppresses the dialog for a second call to the same
    tool but not a different one; aborting mid-dialog leaves no pending approval.
11. **Add — Stop.** Scripted slow stream -> `#chat-send-btn[data-action=stop-response]`, click, assert
    partial text, `[data-tool-run][data-status=cancelled]`, `Stopped by you` in `.response-meta` (reusing
    the assertion at 172), and **zero still-open connections on the fake upstream**.
12. **Add — drawer and settings.** Shortlist badge count matches the header; `useMcpTool` prefills without
    executing; search narrows; Escape closes and restores focus; the Providers rows match `/api/config`; the
    new inputs are inside the widened Tab trap.
13. Keep the zero-console-error checks at 222 / 268 / 293. The bridge must never log to the page, and the
    `file://` page must issue no fetch at all (2.3).
14. Update the summary at 297 to name the new groups.

## Part 4 — `validate-live.mjs` (opt-in, `AURA_LIVE=1`)

Asserts `/api/health` reports the providers reachable, a real `tools/list` returns more than 100 tools,
`get_tool_manifest` returns tiers, and a real exchange completes. Prints provider, model, site, tool
count. Exits non-zero on failure. Never prints a key or an `Authorization` header.

## Part 5 — `README-AURA-BRIDGE.md`

Env table with defaults and what each provider needs; `npm start`; how to point at raw `erpnext-mcp` on 8011
instead of the gateway; the note that write/execute sit behind both Aura's dialog and the gateway's own
gate. Troubleshooting table mapping `401` / `403 approval_required` / `tools/list` returning 0 tools /
Ollama `404 model not found` / `503` while a model loads / CORS-shaped failures to causes.

## Risks and fallbacks

| Risk | Mitigation |
| --- | --- |
| Gateway framing differs from `check_bridge_drift.py`'s assumption | Contract is read from a working reference implementation, so this is verification, not discovery. Task 1 asserts the live response matches before any UI work; a mismatch means the SSE transport, which is a plan change, not an improvisation. |
| A `write` tool reaches the server without approval | Fail closed on unknown tier; explicit exclusion of `call_tool`; the harness asserts zero upstream `tools/call` before Approve. |
| 226 read tools still strains a 3B model via the shortlist | Shortlist is 24 with a 7-tool always-on core. If a live smoke shows degraded tool-call accuracy, drop to 12 and widen only on an explicit `recommend_tools` miss. |
| Abort leaves a provider stream or MCP session alive | Bridge aborts upstream on socket close; page sends `DELETE /mcp`; harness assertion 11 checks connection count. |
| SSE chunks split mid-JSON | Residual buffer per parser; parse only on a complete `\n\n` (SSE) or `\n` (NDJSON) boundary. |
| ERP tool results blow the context window | JSON-aware 24 KB trim, full text kept on the row. |
| Malformed `arguments` JSON | Never throw out of the stream loop; row shows `error` with the raw string and the exchange continues. |
| The `demo` provider masks a real outage | Decision 6: real-provider failure errors loudly; `demo` is auto-selected only when the bridge is unreachable at boot. |
| `file://` page trips the zero-console-error check | Protocol gate before any fetch (2.3), asserted in the `file://` pass. |
| Ollama has no chat model pulled | `/api/tags` is the only readable inventory; the provider row says "no chat model installed - `ollama pull ...`". Never auto-pull. |
| `validate-aura.mjs:20` false-positives on new code | Avoid the literal tokens `innerHTML`, `localStorage`, `sessionStorage`; keep using `replaceChildren` + `textContent`. |
| Two splice sites desync tool rows | `buildUpstreamMessages()` derives from `messages` + `toolRuns`, and the five splice sites change in one pass with the 2.9 table. |

## Out of scope

- Any npm dependency, bundler, framework, or module split. `code.html` stays one file.
- Anthropic-protocol providers. `agentrouter.org` is Anthropic-protocol and will **not** work through the
  Chat Completions adapter; the README says so rather than adding a third adapter.
- Making voice mode or camera inspection real. They stay preview-only.
- File content upload or any persistence. Staged files remain metadata-only.
- Multi-user auth, conversation persistence across reloads.
- Changes to `/home/frappe/erpnext-mcp` or `/home/frappe/erpnext-mcp-gateway`. The bridge is an external
  consumer. (Noted for a separate ticket: `/home/frappe/proxy.js` holds 13 hardcoded `sk-` keys, and
  `start-gateway-live.sh` / `restart_mcp_servers.py` pass the now-rejected `--token` flag.)

## Validation

```bash
node validate-aura.mjs                 # static: vm.Script, duplicate ids, API ban, no-secret check
npm start                              # browse http://127.0.0.1:8790
node validate-aura.mjs --browser       # full harness against the fake upstream
AURA_LIVE=1 node validate-live.mjs     # opt-in, real gateway + real model
```

Interactively: send a prompt, confirm a `.tool-run` appears and resolves, ask something needing a write and
confirm the dialog gates the call, press Stop mid-stream, check the shortlist badge in the MCP drawer, and
confirm the Providers section matches `GET /api/config`.

## Task order

1. **Verify the live wire contract** against `check_bridge_drift.py:62-97` with a throwaway script through
   the bridge skeleton. Record actual status, `Mcp-Session-Id`, and framing. Decide the SSE fallback now if
   it differs.
2. **`test-support/fake-upstream.mjs`** — OpenAI SSE (a plain turn and a tool-call turn), Ollama NDJSON, MCP
   JSON-RPC mirroring `_fake_backend.py` with ~24 fake read tools plus `get_tool_manifest` tiers, a
   `write`-tier tool, a `call_tool` stand-in, a failing tool, and a call log the approval assertion reads.
   `?scenario=` selects the turn shape.
3. **`aura-server.mjs`** — routes, env parsing, header injection, unbuffered pipes, abort-on-close, `DELETE`
   relay. Verify by hand against the fake before touching `code.html`.
4. **State, system prompt, provider registry, model discovery, Providers settings section** (2.1-2.3, 2.11)
   including the Tab-trap fix and the `file://` protocol gate. Run `node validate-aura.mjs` (static only)
   at each step.
5. **MCP client and drawer** (2.5, 2.10) — delete `mcpServerCatalog`, tiers from `get_tool_manifest`, live
   status, shortlist badge, keyboard nav, `useMcpTool` prefills.
6. **Tool retriever** (2.6) plus the exclusion list, plus its harness group, validated against the fake
   catalog before it feeds anything.
7. **Streaming adapters** (2.4) against the fake, before the loop.
8. **Agent loop** (2.8) — replace the send path, keep `queueMockResponse` for `demo`, wire Stop to
   `AbortController`.
9. **Approval dialog** (2.7) + focus trap + `closeMenus` entry + global-click entry, plus the
   security-critical harness group.
10. **Tool timeline rows** (2.9) plus all five splice rules in one pass, including the streaming
    patch-not-rebuild change.
11. **`validate-aura.mjs`** rewrite of the affected groups and the new retriever/tool/approval/stop groups.
12. **`validate-live.mjs`**, **`README-AURA-BRIDGE.md`**, and the **skill file** update.
13. Full run: static + `--browser` + mobile + responsive matrix, then the live smoke.

## Open questions

None blocking. Two implementation-time confirmations, both cheap to change:

- The ERPNext synonym expansion map in 2.6 — seed it from the tool names and doctype strings in a real
  `tools/list` during step 1, then trim to what measurably improves ranking.
- Whether 24 is the right shortlist size. If a live smoke shows degraded tool-call accuracy on Ollama's
  small models, drop to 12; the always-on core and the `recommend_tools` miss path keep coverage intact.
