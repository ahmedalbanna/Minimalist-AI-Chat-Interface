---
name: aura-staging-dashboard
description: Build and maintain the Aura single-file dashboard in this workspace, especially Multimodal Context Engine states, staged file attachments, prompt context, file picker and drag-drop behavior, the responsive Aura shell, and its OpenAI/Ollama providers and erpnext-mcp tool calling with write-tool approval. Trigger when a task mentions Aura, File_Attachment, staging state, staged files, context composer, a dashboard reference image, the Aura bridge, MCP tool tiers, or tool-call approval.
---

# Aura Staging Dashboard

Aura is a browser-openable, no-build prototype whose primary source is `code.html`. Keep the design and behavior coherent when changing the shell, staged context, or chat flow.

Aura is also a real agent when `aura-server.mjs` is running. That changes several rules below, most importantly in sections 5, 6, and 9. Read `README-AURA-BRIDGE.md` before changing anything that touches providers, MCP, or tool calling.

## Stitch reference

Use Stitch project `5056153100982867775` and design system `assets/3811946a7005480595c5888559dfa158` as the visual source of truth. The primary screen references are:

- `a262725eaaff4063b3a58f4ae0d7c924` — file attachment and staging state.
- `a2968e6b2073452dbb23578cde3f8331` — empty and onboarding state.
- `f1781ddc1b8643219a5b34f6868d83e8` — dynamic greeting and prompt suggestions.
- `390679573b084dc5881bc20caa7c7e46` — global search.
- `c7cbaa57b3034a188d63f27ebdd0deba` — slash commands and active input.
- `7fd0bc67009945059a740b88bc652fdf` — active conversation window.
- `fb81a25568074c57b03db3bd190e6433` — assistant and model settings.
- `dbb62bc62b3f45388da49829f360d30d` — MCP servers and tools.
- `82e03fdb65a94c0281a6eba7838efe5c` and `10796b9357d349979f7c5dc636b66d46` — voice call and audio mode.
- `eb5e7fe281144c8491fd386596ecc219` — multimodal camera inspection.

Use MCP metadata, screenshots, and design-system tokens as references. Generated HTML download links may require authenticated browser access and are not local dependencies.

## Source of truth

1. Read `code.html` before editing and preserve the existing shell, event delegation, and memory-only behavior.
2. Treat the supplied design image and design notes as visual references. They are not permission to add a backend — the only backend Aura has is `aura-server.mjs`, and adding routes there is a separate, explicit decision.
3. Keep one browser session authoritative: state lives in JavaScript memory and resets on refresh.
4. New code stays inside the single IIFE. No ESM `import` and no top-level `await`: `validate-aura.mjs` compiles every inline script with `vm.Script` as a classic script.

## Implement workflow

### 1. Map the state

Use the existing state object and keep staged data separate from transcript data:

- `stagedFiles`: id, name, type, size label/bytes, icon, tone, status, and status icon.
- `stagingState`: `ready`, `empty`, `loading`, `success`, or `error`.
- `stagingError`: the recoverable explanation shown by the error state.
- `messages`, `busy`, and the response timer: chat lifecycle only.
- `draft`, model, filters, search, sidebar, and drawer focus: UI state only.

Completion criterion: every new control has one state owner, one update path, and a defined reset or persistence policy.

### State coverage

| State | Entry | Required UI |
| --- | --- | --- |
| `ready` | Initial load or completed context | Three-file reference tray, active prompt, enabled send when text exists |
| `empty` | Every staged file is removed | Empty tray, inviting drop copy, context summary at zero |
| `loading` | Picker or drop accepts new metadata | Pending file chips, busy composer/drop zone, status message |
| `success` | Metadata processing completes | Ready status on new chips, success status pill, toast |
| `error` | Duplicate, oversized, or invalid selection | Recoverable inline message, error styling, reset path |
| `disabled` | Prompt is empty or chat is busy | Disabled send control with unchanged readable label |
| `search-empty` | Blueprint or session query has no match | Focused empty result with a recovery hint |
| `chat-loading` | Prompt is submitted | Typing indicator and guarded duplicate submit |
| `camera-empty` | No image is staged | Inviting empty preview and file-selection path |
| `camera-ready` | A PNG/JPG/JPEG is staged | Metadata summary and enabled analysis action |
| `camera-analyzing` | Analysis is requested | Progress cue, disabled action, and stable preview |
| `camera-success` | Metadata analysis completes | Confirmation and next-action summary |
| `camera-error` | Preview failure is simulated | Plain-language error and retry path |

State transitions are one-way until the user changes the input: `ready → loading → success`, `ready → error → ready`, or `success → empty`. New Chat cancels timers and returns to `ready` when context remains or `empty` when it does not.

A tool call adds its own status family on `.tool-run[data-status]`. Each needs a distinct dot, icon, and label, and each transition needs a browser assertion:

| Status | Entry | Meaning |
| --- | --- | --- |
| `running` | The call was sent upstream | Pulsing dot; the container is a `role="status"` live region. |
| `done` | The server reported success | The only status that may support a claim of success in the assistant's text. |
| `error` | The server reported a failure | The row shows the server's own message. Recoverable: the exchange continues. |
| `blocked` | The gateway's own gate refused the call | Distinct from `error` — nothing was rejected, the gateway declined. |
| `rejected` | The user chose Reject or pressed Escape | The model is told the call was rejected so it adapts. |
| `cancelled` | The user pressed Stop mid-call | Never a claim of success. |

Completion criterion: each state has a visible or accessible representation, a deterministic transition, and a browser assertion.

### 2. Render staged context safely

Render file chips from state with DOM creation and `textContent`. Keep the file tray, count, context-size label, linter pill, and empty state synchronized through one render function.

Each chip needs:

- file name and type badge;
- size and inspection status;
- icon/tone that communicates the file kind;
- a named remove button;
- truncation that does not break the card layout.

Completion criterion: initial state matches the reference, removal updates the count and size immediately, and zero files produces a useful empty state.

### 3. Support staging interactions

Wire the file input, drop zone, and keyboard activation to the same staging function.

- Accept multiple files and names with common code, data, document, and image extensions.
- Enforce the displayed 50 MB per-file limit.
- Skip duplicate names and explain skips through the toast region.
- Show a transient drag state for `dragenter`/`dragover` and clear it on leave/drop.
- Do not read or upload file contents; the prototype stores metadata only.
- Keep the input accessible and expose a descriptive label.

Completion criterion: picker, drag/drop, and keyboard paths produce the same safe metadata state.

### 4. Add keyboard-first search and commands

- Keep the topbar search synchronized with a modal search surface modeled on the Stitch Omni-Search screen.
- Support `⌘K`/Control-K, arrow-key result navigation, Enter selection, Escape close, focus return, and a visible no-results state.
- Detect a leading `/` in the dashboard prompt and render a small inline listbox with keyboard selection and insertion.
- Keep search and command data sourced from existing blueprint/session metadata; do not introduce persistence.

Completion criterion: both surfaces are reachable by keyboard, preserve prompt text, and return focus to a predictable control.

### 5. Keep assistant settings local and accessible

- Open the settings drawer from the primary navigation without replacing the dashboard.
- Keep model selection synchronized across dashboard, chat, and settings. `updateModelLabels()` is the single writer of every `[data-model-label]`; do not introduce a second one.
- Use native buttons for preferences, expose pressed state, and keep values in JavaScript memory only.
- Trap focus inside the modal, close with Escape, and return focus to the navigation trigger.
- The Tab trap must cover `button`, `input`, `select`, and `textarea`. Selecting only buttons silently excluded the Providers section's controls and broke keyboard access.
- The Providers section reports per-provider status, host, discovered model count, and a bridge connection log so a gateway 401 is diagnosable without devtools. It names the exact env var a provider needs, from `/api/config` when the bridge answers and from the local `providerCatalog` when it does not — the `file://` path never fetches, so the fallback is load-bearing.

Completion criterion: settings remain usable at desktop and mobile widths, no secret is ever rendered, and interface preferences still reset on refresh.

### 6. Expose the live MCP surface

- Open the MCP drawer from the sidebar integration row or top navigation.
- Tool names, descriptions, and tiers come from a real `tools/list` and `get_tool_manifest` call, not a local catalog. Group by tier with per-group counts, and show an `unknown` group for tools the manifest does not tier.
- The drawer shows the **full** catalogue, including tools the retriever will never offer a model. The drawer is the user's view of the server; the retriever alone decides what a model may see. Filtering the catalogue here hides tools the server genuinely has.
- Show which tools are in the current turn's shortlist, and the count in the drawer header. Without it, "it cannot see my invoices" is indistinguishable from a real limit.
- Support search, tier selection, keyboard focus, Escape close, and focus return. Search is token-AND, not substring: only `make_sales_invoice` contains the literal phrase "sales invoice", so substring matching hides 6 of 8 real hits.
- Activating a tool prefills the composer with `Use the <tool> tool to `. It must **not** auto-execute — an implicit ERP query from a button click is not predictable.
- Never bypass a tool's tier to read it. `call_tool` is a generic escape hatch that reaches a write tool while its own tier reads "unknown"; exclude it at both the retriever and the executor.

Completion criterion: the drawer reflects the connected server, and a reader can tell which tools a given turn's model can actually see.

### 7. Preview voice mode without device access

- Open the voice drawer from the topbar Audio Mode control or the chat Audio action.
- Represent idle, requesting, listening, processing, playing, error, and reset states explicitly.
- Use deterministic timers and sample text; never request microphone or speaker permissions.
- Trap focus, close with Escape, return focus, and respect reduced motion.

Completion criterion: the audio flow is understandable and testable without implying real voice transport.

### 8. Preview camera inspection without capture access

- Open the camera drawer from the staged composer inspection control.
- Use the first staged PNG/JPG/JPEG metadata as the current image without reading pixels.
- Represent empty, ready, analyzing, success, and error states with a stable preview frame.
- Keep camera permission, upload, and storage explicitly disabled; provide a clear file-selection recovery path.
- Trap focus, close with Escape, return focus, and keep the mobile dialog full-width and scroll-safe.

Completion criterion: the inspection flow is useful and testable while remaining clearly metadata-only.

### 9. Preserve prompt and chat flow

The dashboard composer is a context prompt, not a persistence boundary. Keep the default staged prompt usable, update the send disabled state on input, and route submission through the existing mock chat flow. Staged files may remain in the active context when switching between dashboard and chat; a new chat clears the transcript without silently persisting anything.

Use delegated actions for cards, remove buttons, model selection, and feedback controls. Use `textContent` for user-authored messages and filenames.

The `demo` provider still owns the deterministic mock flow. It must never fabricate tool activity: offline tool-timeline visibility comes from `seedSessions`, not from the mock generator. `queueMockResponse` is the `demo` transport's implementation and stays untouched by the real agent loop.

Completion criterion: submitting a staged prompt opens chat, shows a typing state, produces a deterministic assistant response, and New Chat returns to a usable dashboard.

### 9a. Keep the real agent loop correct

This applies when a real provider is selected. `README-AURA-BRIDGE.md` has the protocol details.

- The upstream transcript is **derived** from `state.messages` and `state.toolRuns` by `buildUpstreamMessages()`. Never keep a second mutable copy alongside `messages`; it desyncs across the five splice sites.
- The five splice sites change together: `saveEditedMessage`, `regenerateMessage`, `startNewChat`, `saveActiveSession`/`resumeSession`, and `seedSessions`. A tool row that outlives its exchange is worse than a missing row.
- Render tool calls as `div.tool-run` rows between messages, **not** `.message-row`, so the `.message-row` count keeps meaning "prose turn".
- Render a row's raw result lazily on first expand. A 200 KB `<pre>` rebuilt on every render is a real jank source.
- `renderChatMessages` does a full `replaceChildren`. Re-running it at 60fps destroys scroll and focus: during streaming, patch only the active bubble's text node, coalesced to one `requestAnimationFrame`, and fully re-render only on `done`, on tool-row transitions, and on error.
- Gate every network call on `location.protocol === 'http:'` before issuing it. On `file://` a relative `/api/health` resolves to `file:///api/health` and Chromium logs a CORS console error, which fails the zero-console-error assertion.
- A real provider that fails shows an error and a Retry. It must **never** silently fall back to `demo`; that would hide a real outage behind a plausible answer. `demo` is auto-selected only when the bridge is unreachable at boot.
- `isError` from MCP is unreliable — a pydantic validation failure arrives with `isError:false` and `{"status":"error"}`. Branch on the status, and prefer the inner envelope's status over the outer one.
- Never throw out of a stream loop. A malformed tool-argument string is a row showing the raw text plus a continued exchange, not a dead page.

Completion criterion: Stop leaves no upstream connection and no pending approval, a rejected tool call tells the model it was rejected so it adapts, and the row reports the server's own status rather than an assumption.

### 10. Preserve the Aura visual system

Use the existing CSS tokens and component language:

- calm off-white/blue canvas;
- royal-blue primary actions;
- low-contrast borders and small ambient shadows;
- Plus Jakarta Sans with system fallbacks;
- Material Symbols with a text/icon fallback;
- fixed topbar, 360px desktop sidebar at wide widths, and drawer navigation at 900px and below;
- safe-area padding for mobile composers;
- reduced-motion behavior.

Do not introduce a second framework, build step, upload service, or persistence layer into this fixture.

Completion criterion: the new state matches the reference hierarchy at desktop and remains usable at 320px through 1600px without viewport horizontal scrolling.

## Accessibility and resilience

- Give every icon-only control an accessible name and title where helpful.
- Keep native buttons, labels, landmarks, and live regions.
- Preserve Escape, focus return, and drawer containment behavior.
- Keep CDN failures non-fatal; the shell and controls must remain usable.
- Avoid a favicon request that produces a console 404 in direct-file checks.

## Validation checklist

Run the project’s available checks after every material change:

1. Run `node validate-aura.mjs` for the static pass; run `node validate-aura.mjs --browser` with Playwright available. Both are required: the static pass catches what the browser cannot see (a swallowed key, a duplicate id, a banned API), and the browser pass is the only thing that catches a regression in a live exchange.
2. Compile each inline script with Node's `vm.Script`. Use `node --check` instead for `.mjs` files — `vm.Script` cannot parse ESM.
3. Parse the HTML and check for duplicate ids and unnamed icon-only buttons.
4. Exercise every state in the state matrix: ready, empty, loading, success, error, disabled, search-empty, chat-loading, audio preview, and camera inspection states.
5. Exercise the initial dashboard, file removal, file picker, drag/drop, prompt insertion, global search, slash commands, model menu, settings preferences, MCP tool browsing, voice preview, camera inspection, send/typing/response, and New Chat.
6. With the bridge running, also exercise a real exchange: a tool row appearing and resolving, a tool error that the exchange recovers from, a write tool opening the approval dialog, Stop mid-stream, and the shortlist count in the MCP drawer.
7. Check the mobile drawer, Escape close, composer submission, and viewport overflow.
8. Open `code.html` directly with `file://` as well as through the bridge. The `file://` pass asserts the degraded path: no banner is wrong, and any `/api/` or `/proxy/` request at all is a failure.
9. Stop temporary servers and remove staging/reference folders only after the main file is verified.

Chromium logs a console error for every non-2xx response it sees. A group that deliberately provokes an upstream error must assert on uncaught `pageerror` only, or filter `Failed to load resource: the server responded with a status of` out of the console stream — otherwise a correct app fails the zero-console-error gate for a reason that is not a bug.

Completion criterion: the dashboard has no page errors, the staged-state assertions pass, and the requested reference folder is gone only when removal is part of the task.
