---
name: Aura AI
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#434655'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#565e74'
  on-secondary: '#ffffff'
  secondary-container: '#dae2fd'
  on-secondary-container: '#5c647a'
  tertiary: '#943700'
  on-tertiary: '#ffffff'
  tertiary-container: '#bc4800'
  on-tertiary-container: '#ffede6'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#dae2fd'
  secondary-fixed-dim: '#bec6e0'
  on-secondary-fixed: '#131b2e'
  on-secondary-fixed-variant: '#3f465c'
  tertiary-fixed: '#ffdbcd'
  tertiary-fixed-dim: '#ffb596'
  on-tertiary-fixed: '#360f00'
  on-tertiary-fixed-variant: '#7d2d00'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
  title-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 16px
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
  code-inline:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  margin: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 2rem
---

## Stitch source

- Project: `5056153100982867775` — Minimalist AI Chat Interface.
- Design system: `assets/3811946a7005480595c5888559dfa158` — Aura AI.
- Primary references: `a262725eaaff4063b3a58f4ae0d7c924` (file attachment and staging), `a2968e6b2073452dbb23578cde3f8331` (empty onboarding), `f1781ddc1b8643219a5b34f6868d83e8` (dynamic greeting and suggestions), `390679573b084dc5881bc20caa7c7e46` (global search), `c7cbaa57b3034a188d63f27ebdd0deba` (slash commands), `82e03fdb65a94c0281a6eba7838efe5c` / `10796b9357d349979f7c5dc636b66d46` (voice and audio), and `eb5e7fe281144c8491fd386596ecc219` (camera inspection).
- The Stitch screen set is the visual and behavioral reference for `code.html`; the local fixture remains browser-openable and memory-only.

## Brand & Style

This design system embodies an ultra-focused, minimalist aesthetic crafted specifically for conversational AI interactions. The visual narrative balances rigorous utilitarian clarity with humane, approachable warmth. Interfaces are quiet, intentional, and void of decorative clutter, allowing the conversation itself to command focus.

The target audience encompasses knowledge workers, researchers, developers, and everyday mobile users seeking immediate, frictionless synthesis of information. Interactions feel instantaneous, dependable, and intelligent.

The visual execution pairs modern reductive minimalism with delicate tactile feedback: crisp micro-borders, airy padding, deliberate typographic hierarchy, and purposeful electric blue cues to confirm execution and intent.

## Colors

The palette relies on a nuanced, clinical off-white foundation punctuated by high-contrast typography and precise royal blue focal accents.

- **Canvas & Surfaces:**
  - Base canvas: `#F8FAFC` (Slate 50) creates a calm, glare-free background.
  - Surface elevations & user containers: `#FFFFFF` (Pure White).
  - AI response containers: `#F1F5F9` (Slate 100) or borderless pure canvas integration.
- **Micro-borders & Structural Dividers:**
  - Structural stroke: `#E2E8F0` (Slate 200).
  - Subtle divider: `#F1F5F9` (Slate 100).
- **Typography & Content Hierarchy:**
  - Primary text: `#0F172A` (Slate 900) ensures maximum contrast and crisp readability.
  - Secondary/Assistant labels: `#475569` (Slate 600).
  - Tertiary/Timestamps/Placeholders: `#94A3B8` (Slate 400).
- **Interactive & Accent:**
  - Primary action / Send trigger / Active glow: `#2563EB` (Blue 600).
  - Primary hover/press: `#1D4ED8` (Blue 700).
  - Subdued accent background / Pill hover: `#EFF6FF` (Blue 50).

## Typography

The type system uses Plus Jakarta Sans across all standard roles to project a clean, contemporary, and engineered voice. Rhythms are tuned strictly for screen reading in long conversational streams.

- Body text balances an open x-height with comfortable leading (`26px` on `16px` base) to avoid fatigue during multi-paragraph generation.
- Code blocks and programmatic syntaxes default to JetBrains Mono at `13px` to maintain character clarity without disrupting the visual line flow.
- Letter spacing is dialed to `-0.01em` on headlines for tight optical cohesion, and `0` on body copy for effortless parsing.

## Layout & Spacing

This layout architecture prioritizes vertical viewport economy for handheld mobile devices while establishing a maximum reading container for wider screens:

- **Mobile Viewport (Primary):** Strict vertical scroll thread using a fluid container with `1rem` outer canvas padding. Gaps between distinct message exchanges are set to `space-lg` (`1.25rem`), while micro-gaps between bubble elements and actions use `space-xs` to `space-sm`.
- **Keyboard Docking:** The persistent input shelf is pinned to the bottom safe area with an interior padding of `space-sm` vertically and `space-md` horizontally, preventing visual cutoff during virtual keyboard activation.
- **Tablet & Desktop Scaling:** When viewport widths exceed 768px, conversational content snaps into a centered reading column capped at 48rem (768px) with outer margins scaling fluidly.

## Elevation & Depth

Visual hierarchy rejects exaggerated drop shadows in favor of crisp low-contrast outlines, subtle tonal stratification, and minimal ambient diffusion.

- **Level 0 (Base Canvas):** Flat `#F8FAFC`.
- **Level 1 (Chat Cards & User Bubbles):** Pure `#FFFFFF` resting against `#F8FAFC`, delimited by a 1px solid stroke of `#E2E8F0`.
- **Level 2 (Floating Action Bars / Fixed Input Bar):** Elevated above thread flow with a 1px top hairline border `#E2E8F0` and an ambient shadow: `0 4px 20px -2px rgba(15, 23, 42, 0.05)`.
- **Level 3 (Modals & Sheet Drawers):** Backdrop dimming at `rgba(15, 23, 42, 0.3)` paired with crisp top-edge borders and ambient diffusion: `0 12px 32px -4px rgba(15, 23, 42, 0.12)`.

## Shapes

The design uses a rounded visual form factor that emphasizes tactile approachability without becoming overly cartoonish.

- **Conversation Bubbles:** Apply `rounded-xl` (`1.5rem` / 24px) for organic conversational flow. User messages feature an asymmetrical bottom-right notch corner (`0.375rem`), while AI outputs maintain an asymmetrical bottom-left taper.
- **Action Chips & Badges:** Full pill-shaped radii (`9999px`) for prompt starters, model switchers, and token metrics.
- **Input Field:** Squircle-styled `1.25rem` radius enclosing the unified prompt textarea and execution button.

## Components

### Conversational Message Bubbles
- **User Messages:** Align right. Background `#2563EB` with `#FFFFFF` text, or secondary clean variant using `#FFFFFF` fill, 1px `#E2E8F0` border, and `#0F172A` text.
- **Assistant Messages:** Align left. Background `#FFFFFF` with 1px `#E2E8F0` border or borderless against `#F8FAFC`. Markdown support with recessed inline code blocks (`#F1F5F9` background, `0.25rem` radius) and customized slate tables.

### Input Dock (Bottom Fixed)
- Encased within a floating container or anchored sticky bar with frosted backdrop blur (`backdrop-filter: blur(12px)`, background `rgba(248, 250, 252, 0.85)`).
- Expanding multi-line text input with dynamic max-height (120px) before internal scrolling begins.
- Integrated Send Button: 36px circle. Disabled state uses `#E2E8F0` fill with `#94A3B8` icon; active state pulses with `#2563EB` fill and `#FFFFFF` forward arrow icon.

### Prompt Suggestion Chips
- Horizontal scrolling drawer above the input composer.
- Height: 32px; border radius: 9999px (pill).
- Background `#FFFFFF`, 1px solid border `#E2E8F0`, typography `label-md` (`#475569`).
- Press state: background `#EFF6FF`, border `#2563EB`, text `#2563EB`.

### Message Action Toolbar
- Subtle micro-actions underneath AI completions (Copy, Regenerate, Thumbs Up, Thumbs Down).
- Icons styled in 16px neutral `#94A3B8`, transitioning to `#0F172A` on tap with haptic trigger.

### Streaming Indicator
- Three pulsing dots cycling between `#94A3B8` and `#2563EB` at 1.2s intervals, anchored inside an AI bubble prior to content arrival.