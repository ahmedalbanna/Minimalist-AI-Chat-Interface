---
name: browser-validation
description: Validate static or browser-facing frontends with syntax checks, HTML inspection, responsive browser tests, accessibility checks, console monitoring, and direct-file loading. Trigger when a task asks to test a web UI, run Playwright, verify responsive behavior, check interactions, or catch browser console and accessibility regressions.
---

# Browser Validation

Validate the interface as a user experiences it, not only as source text. Keep checks proportional to the repository: discover the project’s commands before adding tooling.

## Preflight

1. Read the project layout and identify the entry HTML, package scripts, test runner, and any existing browser configuration.
2. Prefer existing commands. In a no-build fixture, do not introduce a package manager just to run a check.
3. If a browser dependency is cached or available, use it; otherwise report the missing dependency instead of hiding a skipped browser check.

Completion criterion: the selected validation path is known and does not alter the project’s dependency model.

## Static checks

- Compile every inline script with the project’s JavaScript runtime.
- Parse the HTML and check for duplicate ids, missing required entry points, and malformed script boundaries.
- Check that icon-only buttons have accessible names and that repeated dynamic rows have stable selectors.
- Search for accidental persistence, secrets, debug logging, and references to removed staging folders.
- For this no-build fixture, `node validate-aura.mjs` runs static checks and `node validate-aura.mjs --browser` adds the direct-file Playwright pass when available.

Completion criterion: static checks pass before spending time on browser interaction.

## State coverage

Do not validate only the happy path. For each dynamic surface, trigger and assert:

- default/ready content;
- empty content and its recovery affordance;
- loading progress and duplicate-submit guard;
- success confirmation;
- error message and retry/reset path;
- disabled controls and the condition that enables them;
- focus, hover, and active states where the UI exposes them.

State assertions should read accessible text, attributes, or stable classes rather than relying on animation timing alone.

Completion criterion: each required state is reachable in the browser and leaves the interface usable after recovery.

## Browser matrix

Run a small, deterministic matrix:

| Viewport | Coverage |
| --- | --- |
| Wide desktop | Shell, navigation, primary content, model menu, card grid |
| Desktop/tablet | Drawer transition, two-column layouts, readable controls |
| Mobile | Drawer focus, stacked cards, composer, touch-sized actions |
| Narrowest supported width | No clipped controls or viewport horizontal scroll |

For each page, collect `pageerror` and console errors. Treat expected external-resource failures separately from application errors; an application must remain usable when CDN assets are unavailable.

Completion criterion: each viewport loads without application errors and the key controls remain visible and operable.

## Interaction pass

Exercise the smallest meaningful path for the change:

1. initial state and data rendering;
2. one primary submit or navigation action;
3. one dynamic-data path such as remove/add/filter;
4. one asynchronous path such as typing/loading/success;
5. search, command, settings, MCP, audio, or camera open/select/dismiss behavior when those surfaces exist;
6. reset, cancel, Escape, and focus return where applicable;
7. direct `file://` loading when the artifact is intended to be browser-openable.

Completion criterion: the interaction path completes without duplicate submits, stale state, or inaccessible focus.

## Overflow and visual checks

Measure both `document.documentElement.scrollWidth` and the actual rects of the changed components. A clipped label or fixed drawer can be hidden by an ancestor while still producing a layout defect. Check computed display, width, and grid columns at each breakpoint.

Capture a desktop and mobile screenshot for visual changes. Inspect hierarchy, spacing, card widths, footer placement, and the changed state rather than relying on DOM assertions alone.

Completion criterion: the changed state is visually coherent and no changed component extends beyond the viewport.

## Reporting

Report the commands or checks run, the viewport coverage, and any skipped check with its reason. Stop temporary servers and remove temporary artifacts after validation.

Completion criterion: another agent can reproduce the result from the report without relying on hidden browser state.
