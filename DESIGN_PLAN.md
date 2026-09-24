# Aura Design Implementation Plan

## Objective

Use Stitch project `5056153100982867775` as the visual and behavioral source of truth for the browser-openable Aura prototype in `code.html`. Reconcile the existing shell and staged-context dashboard with the Stitch design system and screen set, while preserving the no-build, memory-only architecture.

## Source of truth

- Stitch project: `projects/5056153100982867775` — Minimalist AI Chat Interface.
- Stitch design system: `assets/3811946a7005480595c5888559dfa158` — Aura AI.
- Local implementation: `code.html`.
- Design documentation: `DESIGN.md`.
- Project-specific workflow guidance: `.kilo/skills/aura-staging-dashboard/SKILL.md` and `.kilo/skills/frontend-interface-design/SKILL.md`.
- Stitch source screens are treated as visual/interaction references. Do not add a backend, upload service, persistence layer, or second framework.

## Existing baseline

`code.html` already contains the Aura shell, responsive sidebar/drawer, staged file tray, context composer, blueprints, resume card, model menu, chat view, mock response flow, and explicit staging states. The implementation is 4,530 lines in a single HTML file and has no package manifest or build step.

Current behavior that must remain compatible:

- The default context contains `docker-compose.prod.yml`, `q3_churn_analysis.csv`, and `auth_architecture_diagram.png`.
- File input, drag/drop, removal, duplicate handling, and the 50 MB per-file limit all use one metadata-only staging path.
- Prompt submission opens the chat view, shows a typing state, and produces a deterministic local response.
- New Chat clears the transcript and staging timers while preserving the in-memory staged context.
- The mobile drawer, Escape close, focus return, live toast region, and safe DOM APIs for user content are already established.

## Design direction

Adopt the Stitch Aura AI tokens as the canonical visual contract and expose them through the existing CSS variables:

| Role | Token/value | Use |
| --- | --- | --- |
| Canvas | `#f8f9ff` | Main application background |
| Surface | `#ffffff` | Cards, composer, chat bubbles |
| Low surface | `#eff4ff` | Staged files, secondary panels |
| Container surface | `#e5eeff` | Selected or informational surfaces |
| Primary action | `#2563eb` | Send, selected, focus-confirmed actions |
| High-contrast primary | `#004ac6` | Text/pressed emphasis where contrast requires it |
| Primary text | `#0b1c30` | Headings and primary copy |
| Secondary text | `#434655` | Supporting copy and metadata |
| Outline | `#737686` | Secondary controls and dividers |
| Outline variant | `#c3c6d7` | Card borders and low-emphasis structure |
| Error | `#ba1a1a` | Error text and destructive emphasis |
| Error container | `#ffdad6` | Recoverable error surface |
| Success | `#15803d` or a Stitch-compatible success role | Completed staging/response confirmation |

Typography:

- Plus Jakarta Sans for shell, labels, and conversation text.
- JetBrains Mono for code and metadata where a monospace treatment is meaningful.
- Preserve the Stitch scale: 30/24/18px headings, 16/14/13px body, and 13/11px labels.
- Use the Stitch spacing rhythm: 4, 8, 12, 16, 20, and 32px.
- Use 8px as the default control radius, 16–20px for the composer/cards, 24px for message bubbles, and full pills for chips.

Visual rules:

- Keep the quiet off-white canvas, crisp low-contrast borders, royal-blue focal actions, and restrained ambient elevation described in the Stitch design system.
- Do not rely on color alone for state; pair it with text, icon, and an accessible live region.
- Keep dynamic dimensions stable: file chips, composer footer, send controls, drawer, and modal should not shift when status text changes.
- Keep Material Symbols optional; every icon-only control needs a text label, `aria-label`, or visible fallback.

## Screen map

| Stitch screen | Screen ID | Local mapping | Planned treatment |
| --- | --- | --- | --- |
| File Attachment & Staging State (Desktop) | `a262725eaaff4063b3a58f4ae0d7c924` | `#dashboard-view`, `#staging-composer-card`, `#staged-file-tray` | Preserve as the primary context surface; align hierarchy, file metadata, footer status, and drop target to the Stitch reference. |
| Empty & Onboarding State (Desktop) | `a2968e6b2073452dbb23578cde3f8331` | `state.stagingState === 'empty'` and blueprint/session empty regions | Add a deliberate clear-context/onboarding treatment rather than only a small inline tray message. |
| Dynamic Greeting & Prompt Suggestions (Desktop) | `f1781ddc1b8643219a5b34f6868d83e8` | `.staging-welcome-header`, `#blueprints` | Reconcile greeting hierarchy, model/sync metadata, and blueprint card proportions with the Stitch screen. |
| Global Omni-Search Modal (Desktop) | `390679573b084dc5881bc20caa7c7e46` | `#global-search`, `#blueprints` | Evolve inline blueprint filtering into a keyboard-first search surface with results, empty state, and focus management. |
| Slash Commands & Active Input (Desktop) | `c7cbaa57b3034a188d63f27ebdd0deba` | `#prompt-input` | Add a lightweight inline command surface for `/` input with keyboard selection and insertion. |
| Active Conversation Window (Mobile) | `7fd0bc67009945059a740b88bc652fdf` | `#chat-view`, `.chat-messages`, `.chat-composer-dock` | Align message bubbles, transcript spacing, action toolbar, and bottom input dock with Stitch. |
| Chat History Drawer | `791bde046271412ab536e05d0fb12fbc` | `#sidebar` and mobile drawer | Preserve focus trap/return behavior while matching the Stitch drawer hierarchy and metadata. |
| Assistant & Model Settings | `fb81a25568074c57b03db3bd190e6433` | `#settings-modal` and `#model-menu` | Add a responsive settings drawer with model selection and local preview preferences. |
| Voice Call & Audio Mode | `82e03fdb65a94c0281a6eba7838efe5c` | audio toast controls | Defer functional voice/audio implementation; preserve the current clear preview limitation. |
| Multimodal Camera Inspection | `eb5e7fe281144c8491fd386596ecc219` | screenshot/preview controls | Defer; do not imply camera capture in the metadata-only prototype. |

## State model

Use one JavaScript state object and explicit render/update paths. Add only the state required by the screen being implemented.

| Domain | States | Required representation |
| --- | --- | --- |
| View | `dashboard`, `chat` | Hidden/semantic view switch, focus target, body state |
| Staging | `ready`, `empty`, `loading`, `success`, `error` | Card `data-state`, status label, live message, pending file chips, recovery path |
| Prompt | `idle`, `active`, `disabled`, `submitted` | Textarea value, send disabled state, keyboard hint |
| Search | `closed`, `open`, `results`, `empty` | Modal visibility, result list, no-result message, focus return |
| Commands | `hidden`, `open`, `selected` | Inline listbox, highlighted command, insertion into prompt |
| Drawer | `closed`, `open` | `aria-expanded`, scrim, focus containment, Escape close |
| Chat | `idle`, `typing`, `response` | Transcript, typing indicator, guarded submit, response actions |
| Model menu | `closed`, `open` | Listbox state, selected option, Escape/focus behavior |

State rules:

- Every transition has one owner; never derive a control’s state only from CSS class side effects.
- `stagingState` transitions are `ready → loading → success`, `ready → error → ready`, and `ready/success → empty` when the last file is removed.
- `loading` and `chat typing` must prevent duplicate submission.
- New Chat cancels timers, clears the transcript, and returns to a usable dashboard without persistence.
- Use `textContent` for filenames, prompt text, model labels, and generated text.

## Implementation phases

### Phase 0 — Baseline and visual audit

- Compare the current desktop/mobile renders against the five primary Stitch screens.
- Record spacing, type scale, border, elevation, and control-height differences in the implementation notes.
- Confirm the CSS token mapping before changing component markup.
- Add no new dependencies or build tooling.

Acceptance criteria:

- The current shell, default staged state, empty state, and chat state are reproducible at 1600px, 1024px, 390px, and 320px.
- The audit identifies only visual/interaction gaps, not undocumented product requirements.

### Phase 1 — Canonical Aura foundation

- Normalize CSS variables to the Stitch token roles.
- Standardize the topbar, 360px desktop sidebar, centered content column, and ≤900px drawer ownership.
- Establish shared control primitives: icon button, status pill, bordered card, send button, focus ring, and input dock.
- Preserve system-font and icon fallbacks for direct `file://` loading.

Acceptance criteria:

- The shell matches the Stitch visual hierarchy at desktop and remains usable at 320px without horizontal scrolling.
- Existing dashboard and chat selectors continue to work.

### Phase 2 — Dashboard and onboarding composition

- Reconcile the greeting header, model/sync metadata, context composer, blueprints, and resume section with the dynamic-greeting reference.
- Add a complete empty/onboarding state for cleared context, including a clear explanation and a browse/drop recovery action.
- Keep blueprint cards consistent in height, truncation, category tone, hover, focus, and selected/pressed states.
- Ensure the composer remains the visual anchor and does not compete with the greeting or secondary sections.

Acceptance criteria:

- Ready and empty dashboard compositions are distinct, useful, and visually stable.
- Removing all staged files exposes a clear onboarding path and synchronized zero-count/size labels.

### Phase 3 — Staged context system

- Reconcile file cards with the Stitch attachment screen: type badge, icon tone, size, processing/inspection status, and named remove action.
- Keep the file input, drop zone, and keyboard activation on the same staging function.
- Add deterministic loading, success, duplicate/oversize error, and recovery transitions without reading file contents.
- Keep linter and context-size indicators derived from the same staged-file state.

Acceptance criteria:

- Every staging state has a visible and accessible representation.
- Picker, drag/drop, and keyboard paths produce the same metadata-only result.
- User-controlled filenames remain safe and long names truncate without breaking the tray.

### Phase 4 — Search and command surfaces

- Replace or augment inline blueprint filtering with a centered/global search surface based on the Stitch Omni-Search screen.
- Support `/` command detection in the prompt, an inline listbox, arrow-key navigation, Enter selection, Escape dismissal, and insertion into the textarea.
- Keep search and command results keyboard-first and announce result changes through appropriate live regions.
- Ensure the surfaces do not obscure the composer or introduce horizontal overflow on mobile.

Acceptance criteria:

- `⌘K`/Control-K opens search; Escape closes and returns focus.
- Empty search results provide a recovery hint.
- A command can be selected without losing the current prompt text or focus position.

### Phase 5 — Chat and model continuity

- Reconcile the active conversation screen with Stitch message spacing, bubble tones, code treatment, action toolbar, and bottom input dock.
- Keep the mock response lifecycle deterministic and memory-only.
- Keep model selection synchronized across dashboard, chat, and the responsive settings drawer.
- Add local preview preferences for streaming mode, memory-only sessions, and MCP context status.
- Preserve New Chat, regenerate, copy, and rating actions through delegated handlers.

Acceptance criteria:

- Prompt submission cannot duplicate while typing.
- Assistant response actions work from keyboard and pointer input.
- The settings drawer opens from navigation, traps focus, supports model/preference updates, and closes with Escape.
- Back-to-dashboard, New Chat, and model selection all leave a consistent state.

### Phase 6 — Deferred product surfaces

- Do not implement real audio, camera, MCP transport, uploads, or backend persistence in this fixture.
- If requested later, add each as a separate feature slice with its own state and Stitch screen reference.

## File-level change map

- `code.html`: token normalization, screen composition, state model, event handlers, and responsive behavior.
- `DESIGN.md`: synchronize any verified Stitch token or component decisions; preserve the existing design narrative.
- `.kilo/skills/aura-staging-dashboard/SKILL.md`: update source references, state matrix, and validation cases when the implementation changes.
- `.kilo/skills/frontend-interface-design/SKILL.md`: keep the generic state and accessibility requirements aligned with the final patterns.
- `test-results/`: remain generated and untracked unless the repository later adopts a test runner.

## Validation plan

Static checks:

- Run `node validate-aura.mjs` for the no-build static pass; run `node validate-aura.mjs --browser` with Playwright available for the direct-file browser pass.
- Compile every inline script with Node `vm.Script`.
- Parse the HTML and verify unique IDs, named controls, and semantic landmarks.
- Check for user-content `innerHTML` regressions and accidental persistence code.
- Check the Stitch token values and responsive breakpoint assumptions.

Browser checks at 1600×1000, 1024×900, 390×844, and 320×800:

- Initial dashboard and clear-context onboarding.
- Search open, results, empty results, Escape, and focus return.
- Slash command open, keyboard selection, insertion, and Escape.
- File picker, drag/drop, pending/loading, success, duplicate/oversize error, recovery, and remove-last-file.
- Send disabled, chat typing, response, action toolbar, New Chat, and model menu.
- Mobile drawer open/close, focus return, safe-area composer, no horizontal overflow, and reduced motion.
- Load `code.html` directly with `file://` and through a temporary local server; require zero page errors.

Visual checks:

- Capture the same viewport/state pairs as the primary Stitch screens.
- Compare hierarchy, spacing, typography, border treatment, and empty/loading/error presentation rather than only checking DOM presence.

## Risks and decisions

- Stitch generated HTML download links require authenticated Google access; use MCP metadata, screenshots, and the returned design system as the reliable source rather than treating those links as local dependencies.
- The Stitch project contains many secondary screens; implement the core dashboard/chat/search/command slice first and keep the rest explicitly deferred.
- The local `DESIGN.md` and Stitch named colors differ slightly in some surface values; the implementation phase should choose one documented mapping and apply it consistently rather than mixing values.
- Do not turn this design plan into a backend or upload implementation without a separate product decision.
