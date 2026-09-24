---
name: aura-staging-dashboard
description: Build and maintain the Aura single-file dashboard in this workspace, especially Multimodal Context Engine states, staged file attachments, prompt context, file picker and drag-drop behavior, and the responsive Aura shell. Trigger when a task mentions Aura, File_Attachment, staging state, staged files, context composer, or a dashboard reference image.
---

# Aura Staging Dashboard

Aura is a browser-openable, no-build prototype whose primary source is `code.html`. Keep the design and behavior coherent when changing the shell, staged context, or chat flow.

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

Use MCP metadata, screenshots, and design-system tokens as references. Generated HTML download links may require authenticated browser access and are not local dependencies.

## Source of truth

1. Read `code.html` before editing and preserve the existing shell, event delegation, and memory-only behavior.
2. Treat the supplied design image and design notes as visual references, not as permission to add a backend.
3. Keep one browser session authoritative: state lives in JavaScript memory and resets on refresh.

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

State transitions are one-way until the user changes the input: `ready → loading → success`, `ready → error → ready`, or `success → empty`. New Chat cancels timers and returns to `ready` when context remains or `empty` when it does not.

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
- Keep model selection synchronized across dashboard, chat, and settings.
- Use native buttons for preferences, expose pressed state, and keep values in JavaScript memory only.
- Trap focus inside the modal, close with Escape, and return focus to the navigation trigger.

Completion criterion: settings remain usable at desktop and mobile widths without implying backend persistence.

### 6. Expose MCP preview surfaces

- Open the MCP drawer from the sidebar integration row or top navigation.
- Present connected servers, tool names, descriptions, and statuses from one local catalog.
- Support search, server selection, keyboard focus, Escape close, and focus return.
- Treat tool activation as a preview action; do not imply transport, credentials, or persistence.

Completion criterion: MCP browsing is useful, responsive, and clearly bounded to the current browser tab.

### 7. Preserve prompt and chat flow

The dashboard composer is a context prompt, not a persistence boundary. Keep the default staged prompt usable, update the send disabled state on input, and route submission through the existing mock chat flow. Staged files may remain in the active context when switching between dashboard and chat; a new chat clears the transcript without silently persisting anything.

Use delegated actions for cards, remove buttons, model selection, and feedback controls. Use `textContent` for user-authored messages and filenames.

Completion criterion: submitting a staged prompt opens chat, shows a typing state, produces a deterministic assistant response, and New Chat returns to a usable dashboard.

### 8. Preserve the Aura visual system

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

1. Run `node validate-aura.mjs` for the static pass; run `node validate-aura.mjs --browser` with Playwright available.
2. Compile each inline script with Node's `vm.Script` or the equivalent project command.
3. Parse the HTML and check for duplicate ids and unnamed icon-only buttons.
4. Exercise every state in the state matrix: ready, empty, loading, success, error, disabled, search-empty, and chat-loading.
5. Exercise the initial dashboard, file removal, file picker, drag/drop, prompt insertion, global search, slash commands, model menu, settings preferences, MCP server/tool browsing, send/typing/response, and New Chat.
6. Check the mobile drawer, Escape close, composer submission, and viewport overflow.
7. Open `code.html` directly with `file://` as well as through a temporary local server.
8. Stop temporary servers and remove staging/reference folders only after the main file is verified.

Completion criterion: the dashboard has no page errors, the staged-state assertions pass, and the requested reference folder is gone only when removal is part of the task.
