---
name: rice-mice
description: A lean, warm CRM + POS for small food businesses — sharp-edged, dense, and hospitable.
colors:
  hearth-orange: "oklch(0.553 0.195 38.402)"
  hearth-orange-deep: "oklch(0.47 0.157 37.304)"
  warm-ink: "oklch(0.147 0.004 49.25)"
  paper-white: "oklch(1 0 0)"
  warm-panel: "oklch(0.985 0.001 106.423)"
  warm-muted: "oklch(0.97 0.001 106.424)"
  warm-grey: "oklch(0.553 0.013 58.071)"
  cool-secondary: "oklch(0.967 0.001 286.375)"
  hairline: "oklch(0.923 0.003 48.717)"
  alert-red: "oklch(0.577 0.245 27.325)"
  night-warmth: "oklch(0.147 0.004 49.25)"
  chart-amber: "oklch(0.837 0.128 66.29)"
  chart-tangerine: "oklch(0.705 0.213 47.604)"
  chart-flame: "oklch(0.646 0.222 41.116)"
  chart-hearth: "oklch(0.553 0.195 38.402)"
  chart-rust: "oklch(0.47 0.157 37.304)"
typography:
  heading:
    fontFamily: "Oxanium, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "normal"
  body:
    fontFamily: "Outfit, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.625
    letterSpacing: "normal"
  label:
    fontFamily: "Outfit, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  none: "0px"
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
spacing:
  card-sm: "0.75rem"
  card: "1rem"
components:
  button-primary:
    backgroundColor: "{colors.hearth-orange}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.none}"
    padding: "0 0.625rem"
    height: "2rem"
  button-primary-hover:
    backgroundColor: "{colors.hearth-orange-deep}"
    textColor: "{colors.paper-white}"
  button-outline:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.warm-ink}"
    rounded: "{rounded.none}"
    padding: "0 0.625rem"
    height: "2rem"
  button-destructive:
    backgroundColor: "{colors.alert-red}"
    textColor: "{colors.alert-red}"
    rounded: "{rounded.none}"
    padding: "0 0.625rem"
    height: "2rem"
  input:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.warm-ink}"
    rounded: "{rounded.none}"
    padding: "0.25rem 0.625rem"
    height: "2rem"
  card:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.warm-ink}"
    rounded: "{rounded.none}"
    padding: "1rem"
---

# Design System: rice-mice

## 1. Overview

**Creative North Star: "The Warm Counter"**

rice-mice is the front counter of a food stall, rendered in software. It carries two tempos in one system: a walk-in customer standing at the counter with seconds of patience, and an owner settling in for a whole shift. The look that serves both is *warm but efficient* — hospitable in color and voice, but sharp, dense, and fast in structure. Nothing here is soft or apologetic: edges are square, controls are compact, surfaces sit flat and confident. The warmth lives in the hue (a hearth orange), the neutrals (warm stone, never cold slate), and the copy — not in rounded corners or drop shadows.

This system explicitly rejects three things named in the product brief. It is **not a cold POS terminal** — no sterile grey checkout-machine surface; the shop's warmth has to come through the orange and the warm neutrals. It is **not a generic AI SaaS template** — no cream background, no purple gradients, no tiny tracked-uppercase eyebrows above every section, especially anywhere near the AI findings. And it is **not an anxious, alarm-heavy dashboard** — destructive and warning states are always *tints*, never a flood of solid red badges. Calm intelligence: the app advises, it never nags.

The density is deliberate. This is a working tool an owner sits inside — tables with many rows, panels with many labels, a compact type scale (12px body, 32px controls). It should feel like Linear or Raycast wearing the apron of a neighbourhood shop: earned familiarity, no invented affordances, the tool disappearing into the task.

**Key Characteristics:**
- Sharp corners everywhere (`rounded-none` / 0px) — the default component shape.
- Warm-orange identity over warm-stone neutrals; never cold grey, never cream.
- Flat by construction: hairline rings and borders convey depth, not shadows.
- Compact and dense: 12px base text, 32px control height, tight paddings.
- Oxanium headings against an Outfit body — a squared, technical display voice over a rounded-geometric workhorse.

## 2. Colors

A warm-stone neutral field carrying a single hearth-orange accent, with an amber→rust ramp reserved for data.

### Primary
- **Hearth Orange** (`oklch(0.553 0.195 38.402)`): The one brand voice. Primary buttons, the current selection, sidebar-active state, focus intent, and the anchor of the chart ramp. Used for action and state, never as decoration.
- **Hearth Orange Deep** (`oklch(0.47 0.157 37.304)`): The dark-mode primary and the pressed/hover deepening of the accent. Also the darkest step of the data ramp.

### Neutral
- **Warm Ink** (`oklch(0.147 0.004 49.25)`): Primary text on light; the warm near-black body background in dark mode. Warm-tinted, never a pure cold black.
- **Paper White** (`oklch(1 0 0)`): The content surface — page and card background in light mode.
- **Warm Panel** (`oklch(0.985 0.001 106.423)`): The second neutral layer — sidebar and toolbar surfaces, set a hair off the content white so panels read as their own plane.
- **Warm Muted** (`oklch(0.97 0.001 106.424)`): Muted/hover fills and quiet backgrounds behind secondary content.
- **Warm Grey** (`oklch(0.553 0.013 58.071)`): Muted foreground — captions, meta, placeholder text. Warm-tinted; verify it clears 4.5:1 on any surface it labels.
- **Hairline** (`oklch(0.923 0.003 48.717)`): Borders, input strokes, and dividers. The workhorse edge of a flat system.
- **Cool Secondary** (`oklch(0.967 0.001 286.375)`): The lone cool-tinted neutral, for `secondary` chips/buttons where a step away from the warm field reads as "quieter, not-primary."

### Semantic
- **Alert Red** (`oklch(0.577 0.245 27.325)`): Destructive and error only — and almost always as a **tint** (10–20% fill behind red text), not a solid red flood.

### Data (chart ramp)
- **Amber → Rust** (`chart-amber` `oklch(0.837 0.128 66.29)` through `chart-rust` `oklch(0.47 0.157 37.304)`): A five-step warm ramp for charts and categorical data, ordered lightest amber to deepest rust. It stays inside the brand's warm band on purpose — data viz should feel like the same shop, not a rainbow bolted on.

### Named Rules
**The One Orange Rule.** Hearth Orange means action or state — primary button, current selection, focus, active nav. If a surface is orange for decoration, it's wrong. Its scarcity is what makes a "signed up!" or a selected row read instantly.

**The Warm-Neutral Rule.** Every grey in this system is warm-tinted (hue ~48–106). A cold slate or a cream body background is a foreign object — the first reads as a POS terminal, the second as generic AI SaaS. Both are banned.

## 3. Typography

**Display Font:** Oxanium (with `ui-sans-serif, system-ui` fallback)
**Body Font:** Outfit (with `ui-sans-serif, system-ui` fallback)

**Character:** A deliberate two-family pairing on a contrast axis: Oxanium is squared, technical, faintly mechanical — it gives headings and card titles a confident edge that echoes the sharp corners. Outfit is a rounded geometric workhorse that stays quiet and legible from 12px labels up through data. Headings assert; body recedes.

### Hierarchy
- **Heading / Card Title** (Oxanium, 500, ~0.875–1rem, line-height 1.2): Page titles and `CardTitle`. Applied via the `font-heading` utility. Squared display voice; keep it for headings, never for data or long labels.
- **Body** (Outfit, 400, 0.75rem / 12px, line-height 1.625): The base text of the app — card bodies (`text-xs/relaxed`), descriptions, most content. Dense by design; prose blocks still cap at 65–75ch.
- **Label** (Outfit, 500, 0.75rem / 12px): Buttons, form labels, chips, table headers. Medium weight carries emphasis; case stays sentence/normal — no tracked uppercase.

### Named Rules
**The Fixed-Scale Rule.** This is product UI: type is a fixed rem scale (12px base, ~1.125–1.2 ratio), never `clamp()`-fluid. A heading that shrinks inside a sidebar looks broken, not responsive.

**The No-Eyebrow Rule.** No tiny all-caps tracked kicker above sections. It's the generic-AI-SaaS tell the brief bans by name — doubly forbidden around the AI findings.

## 4. Elevation

This system is **flat by construction**. There are no drop shadows. Depth is conveyed two ways: (1) **tonal layering** — the warm-panel sidebar sits a step off the paper-white content, muted fills recede behind it; and (2) **hairline rings and borders** — cards carry a `ring-1 ring-foreground/10` (a 1px inset ring at ~10% ink), inputs carry a 1px hairline border, footers a `border-t`. Nothing floats; everything is a plane defined by its edge and its tone.

### Named Rules
**The Ring, Not Shadow Rule.** Cards and surfaces are bounded by a hairline ring or border, never lifted by a shadow. If you're reaching for `box-shadow` to separate two surfaces, change the tone or add a 1px edge instead. A shadow here reads as a foreign component pasted in.

**The Flat-Press Rule.** The only "depth" is interaction feedback: a pressed button drops one pixel (`active:translate-y-px`). State earns motion; rest is flat.

## 5. Components

Compact, square, and consistent. Every interactive control shares the same 32px default height, the same sharp corners, and the same focus treatment.

### Buttons
- **Shape:** Sharp corners (`rounded-none`, 0px) on every size. 1px transparent border reserved so bordered variants don't shift layout.
- **Sizes:** `xs` 24px / `sm` 28px / **default 32px** (`h-8`) / `lg` 36px, plus square icon variants (24/28/32/36px). Horizontal padding ~10px (`px-2.5`), text 12px medium.
- **Primary:** Hearth-orange fill, paper-white text (`bg-primary text-primary-foreground`). Hover deepens the fill (`hover:bg-primary/80`).
- **Hover / Focus / Active:** `transition-all`; focus-visible sets the ring border plus a 1px `ring-ring/50` halo; active drops one pixel (`translate-y-px`) for a physical press. Disabled: 50% opacity, no pointer.
- **Secondary / Outline / Ghost:** `secondary` = cool-neutral fill; `outline` = hairline border on paper white, hover fills muted; `ghost` = transparent, hover fills muted. All share the sharp shape and 32px rhythm.
- **Destructive:** A **tint**, not a solid — `bg-destructive/10 text-destructive`, hover to `/20`. Deliberate: destructive actions read as serious without flooding the screen red. Never promote this to a solid-red button.

### Inputs / Fields
- **Style:** Sharp (`rounded-none`), 32px tall (`h-8`), 1px hairline border (`border-input`), transparent background, 12px text, ~10px horizontal padding. Placeholder uses warm-grey (verify 4.5:1).
- **Focus:** Border shifts to the ring color plus a 1px `ring-ring/50` halo — the same focus language as buttons.
- **Error / Disabled:** `aria-invalid` shifts border + ring to alert-red tint; disabled drops to a muted fill at 50% opacity, no pointer.

### Cards / Containers
- **Corner Style:** Sharp (`rounded-none`, 0px). Even images inside clip square.
- **Background:** Paper white (`bg-card`); warm-panel for sidebars/toolbars.
- **Shadow Strategy:** None — a `ring-1 ring-foreground/10` hairline ring defines the card (see Elevation).
- **Border:** The ring is the border. Footers add a top `border-t`.
- **Internal Padding:** `--card-spacing` of 16px default (`--spacing(4)`), 12px in the `sm` size. Titles use the Oxanium `font-heading`; descriptions use warm-grey body text.

### Navigation
- **Style:** Warm-panel sidebar/top-bar set off the content surface by tone. Active item carries the hearth-orange (`sidebar-primary`); hover fills muted. Labels are Outfit medium, sentence case. Responsive behavior is structural (collapse the sidebar), never fluid type.

### Named Rules
**The One-Vocabulary Rule.** Every control is 32px tall, square-cornered, and shares the ring/halo focus. If a "Save" button looks different on two screens, one is wrong — consistency is the product virtue, not variety.

## 6. Do's and Don'ts

### Do:
- **Do** keep corners sharp (`rounded-none` / 0px) on buttons, inputs, and cards — it's the system's default shape, not an exception.
- **Do** convey depth with hairline rings/borders and tonal layering; keep surfaces flat.
- **Do** reserve hearth orange for action and state (primary button, current selection, focus, active nav) — the One Orange Rule.
- **Do** keep every neutral warm-tinted (warm stone), and pair Oxanium headings with Outfit body.
- **Do** hold the compact rhythm: 12px base text, 32px control height, tight paddings; use a fixed rem type scale.
- **Do** render destructive/warning states as tints (10–20% fill behind colored text), so an owner is advised, never alarmed.

### Don't:
- **Don't** make it feel like a cold POS terminal — no sterile grey checkout-machine surface; the shop's warmth must come through the orange and warm neutrals.
- **Don't** slip into a generic AI SaaS template — no cream background, no purple gradients, no tiny tracked-uppercase eyebrows above sections, especially around the AI findings.
- **Don't** build an anxious, alarm-heavy dashboard — never a wall of solid-red badges; comfort beats a red flood.
- **Don't** add drop shadows to lift surfaces — change the tone or add a 1px edge instead (the Ring, Not Shadow Rule).
- **Don't** round the corners, inflate the control heights, or reach for `clamp()`-fluid headings — density and sharpness are the point.
- **Don't** use the cancelled/foreign component vocabularies; every control shares one 32px, square, warm shape.
