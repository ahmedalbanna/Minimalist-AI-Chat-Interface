---
name: frontend-interface-design
description: Design and implement polished browser interfaces in static or no-build frontends, using reference images, design tokens, responsive composition, accessible controls, and safe client-side state. Trigger when a task asks for frontend UI, responsive layout, visual design, CDN HTML/CSS, a design system, or a screenshot-to-interface implementation.
---

# Frontend Interface Design

Build the smallest coherent interface that expresses the supplied design. Treat visual hierarchy, responsive behavior, and interaction state as one system.

## Design pass

1. Inspect the existing files, reference image, and design tokens before choosing a component structure.
2. Identify the shell first: navigation, content frame, typography, color roles, elevation, and responsive ownership.
3. Define a short token set for canvas, surfaces, text, borders, primary actions, muted states, and focus rings.
4. Map the reference’s information hierarchy into semantic landmarks before styling details.

Completion criterion: the page structure, type scale, color roles, and responsive ownership are explicit and can be explained without pointing at a screenshot.

## Composition rules

- Use a centered reading column with predictable gutters rather than arbitrary per-card offsets.
- Use CSS grid for card families and flex only for local alignment or action rows.
- Let wide content breathe; stack it at the narrow breakpoint where reading or touch targets degrade.
- Keep fixed navigation, drawers, and composers inside a predictable stacking order.
- Make icon glyphs, loading states, hover states, focus states, and disabled states part of the same visual language.
- Prefer stable dimensions for cards, trays, and send controls; avoid layout shifts caused by icons or long labels.

Completion criterion: a user can scan the page at desktop, tablet, and mobile widths without horizontal viewport scrolling or clipped controls.

## Accessibility pass

- Use native buttons, inputs, textareas, headings, landmarks, and labels.
- Give icon-only controls an accessible name; use `aria-expanded`, `aria-controls`, `aria-hidden`, and live regions only when the state changes warrant them.
- Preserve keyboard paths for menus, drawers, file staging, and modal-like surfaces.
- Keep focus visible and return focus to the control that opened a drawer or menu.
- Respect reduced motion and safe-area insets.

Completion criterion: keyboard-only navigation reaches every action and screen-reader-facing controls have meaningful names.

## State and content discipline

- Keep state in one place and update related labels together.
- Use `textContent` or equivalent safe DOM APIs for user content, filenames, and model output.
- Use event delegation for repeated cards and dynamic rows.
- Treat file attachments as metadata-only in a static prototype; make that limit visible in the interface.
- Avoid `innerHTML` for user-controlled strings and avoid persistence unless the specification requires it.

Completion criterion: dynamic content remains safe after reload and all visible state is explained by the state model.

## State coverage

Design the state surface before polishing the default view. Every data-driven component should account for:

- **Default/ready:** content is available and primary actions are enabled.
- **Empty:** a clear explanation, recovery action, and stable container dimensions.
- **Loading:** a visible progress cue, guarded repeat actions, and preserved layout.
- **Success:** confirmation near the changed control and a useful next action.
- **Error:** plain-language cause, recovery path, and non-destructive retry.
- **Disabled:** readable disabled labeling and an obvious condition that enables it.
- **Focus/hover/active:** visible and consistent with the primary interaction color.

Use one state owner and keep labels, badges, live regions, and control disabled states synchronized. Do not represent an error only by changing a color.

Completion criterion: a state matrix exists for each dynamic surface and every listed state has a reachable trigger and a browser assertion.

## Verification

Use a browser at the project’s available viewport sizes. Check the initial render, an interaction path, a dynamic-data path, and a narrow viewport. Capture screenshots when visual fidelity matters, then compare spacing, hierarchy, and overflow rather than only checking that elements exist.

Run the project’s real lint, typecheck, and test commands when they exist. In a no-build fixture, use syntax checks, an HTML parse, and browser-oriented checks instead of inventing a package workflow.

Completion criterion: the implementation matches the reference’s visual intent, preserves interaction quality, and passes the available validation commands.
