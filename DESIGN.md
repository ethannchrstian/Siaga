---
name: SIAGA Operations Console
description: A calm, action-first command system for human-authorised disaster planning.
colors:
  institutional-navy: "#12182d"
  command-navy: "#0c1b35"
  command-navy-raised: "#14294a"
  cool-canvas: "#f2f4f5"
  work-surface: "#ffffff"
  command-ink: "#122038"
  secondary-ink: "#5f6e7e"
  divider: "#d6dce2"
  state-cyan: "#7bd4dd"
  flood-blue: "#4b7898"
  water-stress-red: "#955159"
  compound-purple: "#6b4c7a"
  pending-amber: "#d39431"
  ready-green: "#2a9a68"
  critical-red: "#d34848"
typography:
  display:
    fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(25px, 2.25vw, 34px)"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  title:
    fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.35
  metric:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "clamp(21px, 2.2vw, 29px)"
    fontWeight: 600
    lineHeight: 1
rounded:
  chip: "5px"
  action: "8px"
  surface: "11px"
  command-field: "15px"
spacing:
  hairline: "5px"
  compact: "8px"
  cluster: "14px"
  surface: "20px"
  command: "36px"
components:
  button-primary:
    backgroundColor: "{colors.command-navy}"
    textColor: "{colors.work-surface}"
    rounded: "{rounded.action}"
    padding: "0 17px"
    height: "44px"
  surface:
    backgroundColor: "{colors.work-surface}"
    textColor: "{colors.command-ink}"
    rounded: "{rounded.surface}"
    padding: "20px"
  status-pending:
    textColor: "{colors.pending-amber}"
    rounded: "{rounded.chip}"
  status-ready:
    textColor: "{colors.ready-green}"
    rounded: "{rounded.chip}"
---

# Design System: SIAGA Operations Console

## Overview

**Creative North Star: "The Calm Command Brief"**

SIAGA is an institutional operations console, not a consumer analytics dashboard. It should make scarce resources, unresolved coverage, evidence limits, and human authority legible under pressure. The visual world is cool, restrained, and information-dense: institutional navy establishes authority; cool-white work surfaces support prolonged scanning; semantic colors identify hazard and decision state.

Primary operational surfaces are action-first. A decisive status or work area should dominate; supporting evidence follows in a narrower rail or progressive disclosure. This is an unequal hierarchy, not a grid of interchangeable cards.

Pemantauan Wilayah extends this model as a focused triage register. Its concentrated navy statement frames the active monitoring problem and places monitored-versus-planned counts together, while a compact scope rail and one continuous register keep evidence comparison in a single synchronized workflow.

**Key Characteristics:**

- Compact command headers and dense, calm work surfaces.
- One dominant decision field, then operational work, validation, and audit.
- Human authority and model limits placed beside consequential actions.
- Monospaced, tabular figures inside a sans-serif interface.
- Responsive restructuring that preserves actions and semantics rather than merely shrinking the desktop.

## Colors

The palette is approximately neutral-first, with navy carrying authority and semantic hues appearing only where their meaning is operational.

### Primary

- **Institutional Navy:** application chrome and agency-level authority.
- **Command Navy:** decisive summaries, authorisation gates, and primary actions.
- **State Cyan:** restrained emphasis within navy fields and current-state cues.

### Secondary

- **Flood Blue:** flood evidence, pump capacity, and flood-resource identity.
- **Water-Stress Red:** water-stress evidence and tanker-resource identity.
- **Compound Purple:** evidence involving both hazards.

### Neutral

- **Cool Canvas:** page ground behind work areas.
- **Work Surface:** tables, rails, drawers, and evidence containers.
- **Command Ink / Secondary Ink:** primary and supporting text.
- **Divider:** one-pixel separation between dense operational regions.

### Named Rules

**The Decision-State Rule.** Green means ready to publish; amber means pending human approval. Never use either as decorative accent or generic positive/negative sentiment.

**The Hazard-Identity Rule.** Flood blue, water-stress red, and compound purple identify evidence and resources; they do not imply authorisation.

**The Navy Concentration Rule.** Concentrate navy in chrome, the primary decision field, and authorisation controls. Keep routine work on cool-white surfaces.

**The Plan-State Cyan Rule.** Cyan inside a navy command field communicates the share already represented in the current plan. It is a plan-state cue, not proof of field readiness, incident confirmation, or allocation authority.

## Typography

**Display Font:** IBM Plex Sans, self-hosted, with Segoe UI and system sans fallbacks.  
**Body Font:** IBM Plex Sans, self-hosted, with the same fallback stack.  
**Metric Font:** IBM Plex Mono, self-hosted, with a UI monospace fallback.

**Character:** Plex Sans is practical and credible at dashboard density; Plex Mono makes quantities, dates, percentages, and identifiers easy to compare. The shipped font files establish weights 400, 500, 600, and 700.

### Hierarchy

- **Display:** page and decisive-field headlines; compact, tightly tracked, and never ornamental.
- **Title:** section names and work-surface headings.
- **Body:** operating explanations, constraints, and row content.
- **Label:** metadata, statuses, column headings, and compact captions; use sentence case by default.
- **Metric:** KPIs and values compared across rows or rails; always use tabular numerals.

### Named Rules

**The Operational Numeral Rule.** Quantities that operators compare use IBM Plex Mono and tabular numerals; prose and place names remain in IBM Plex Sans.

## Layout

Desktop pages use a compact outer gutter and a wide operational canvas. The primary workspace favors an unequal split: a fluid work surface and a narrow validation rail. The Overview implementation uses a 330px rail, 14px region gaps, and 20px surface padding; these are strong starting points for Pemantauan Wilayah and Metode & Data when their content density is comparable.

At narrower desktop widths, the validation rail moves below the work surface and may remain two columns. Below tablet width it becomes one column. On phones, data tables become labeled record cards, primary actions become full-width, and the five-item navigation becomes a fixed-height bottom command bar. Audit and explanatory detail stay behind native disclosure controls.

Monitoring scope controls form a compact synchronized rail: changing scope updates the command statement, result title, count, and register together. On phones the rail remains one line, hides its scrollbar, supports horizontal pointer or touch dragging without turning the page into a sideways-scrolling table, and preserves a trailing overflow fade as the cue that more scopes are available.

**The Action-Before-Evidence Rule.** Put the decision, task, or current operational state before methodology and audit. Do not let explanatory content push the main action below the first useful viewport.

## Elevation & Depth

The system uses shallow ambient shadows plus tonal layering. Work surfaces carry a fine border and a faint lift; the navy decision field receives the strongest shadow because it owns the page hierarchy. Deep shadows, glass effects, and floating decorative cards are outside the system.

**The Bounded-Depth Rule.** Elevation communicates hierarchy or interaction state. Routine rows and nested content are separated by tone and one-pixel rules, not another layer of shadow.

## Shapes

Shapes are compact and gently squared. Chips use tight corners, controls use modest corners, work surfaces use medium corners, and the single command field may use the largest radius. Fully rounded pills are reserved for small counts or compact status tokens; they are not a default container treatment. Borders are usually one pixel, with occasional three-pixel semantic edges for capacity or evidence emphasis.

## Components

### Buttons

- **Primary:** dark navy, white label, 44px minimum height, modest corners, and a slight hover lift. Disabled state loses shadow and reduces opacity.
- **Secondary:** pale blue-gray surface with navy text; invert to navy on hover when it opens a focused operational view.
- **Focus:** a visible three-pixel blue-cyan outline with offset; never rely on color fill alone.

### Chips and statuses

- Resource chips use hazard identity colors and compact rectangular corners.
- Approval statuses pair text with a dot or filled token. Ready and pending states follow the Decision-State Rule.
- Evaluation badges state provenance plainly, including in-sample or out-of-sample context and “not real time” when applicable.

### Cards and containers

- Work surfaces are bordered cool-white regions with one clear job.
- Avoid equal-card mosaics for primary workflows. Use cards only for repeated records, queued follow-ups, or independently actionable items.

### Tables and responsive records

- Allocation and monitoring tables are the main work surface on desktop: clear headers, compact rows, visible provenance, status, and row action.
- On phones, hide the header and convert each row into a stacked record with explicit inline labels and a full-width action.
- Treat the monitoring register as one continuous surface: heading and evidence legend, filtering controls, active filters, sortable records, pagination, and selected-district detail belong to the same bounded work area.

### Monitoring command and scope rail

- The monitoring command statement explicitly separates visual monitoring from allocation: crossing the 50% monitoring threshold is neither a confirmed incident nor an automatic allocation trigger.
- Show planned and not-yet-planned monitored districts side by side. Use cyan for the planned share and a muted warning red for the open share; neither state asserts dispatch or field readiness.
- Scope buttons expose their selected state with `aria-pressed`; the rail has a semantic navigation label; risk bars expose labeled progressbar values; sort controls publish `aria-sort`; icon-only actions carry explicit accessible names.
- Scope changes update the command statement, register title, result count, and rows as one state transition. Never let the rail behave as an independent decorative filter strip.

### Capacity tracks

- Show used and available quantities, a visible capacity fill, and the 80% attention threshold.
- Every track exposes `progressbar` semantics with a label, minimum, maximum, current value, and human-readable value text.

### Navigation and disclosure

- Section jump bars make long operational pages locally navigable.
- Methodology, audit, and provenance use native disclosure so the default view remains operational.
- The mobile command bar retains five primary destinations and visible labels.

## Do's and Don'ts

### Do:

- **Do** lead each screen with the operator’s current task, decision, or state.
- **Do** keep Pusdalops/BPBD authority and field-validation requirements visible near publishing or mobilisation actions.
- **Do** distinguish recommendations, operator locks or redirects, and published orders.
- **Do** distinguish monitored districts from districts currently included in the pre-positioning plan, in both copy and plan-state color.
- **Do** preserve data provenance and evaluation context beside the evidence it qualifies.
- **Do** design desktop tables and mobile records as two intentional presentations of the same information.
- **Do** preserve semantic labels when visual table headers are removed on phones.

### Don't:

- **Don't** flatten the screen into equal KPI and content cards.
- **Don't** use green for “healthy,” “good,” or decorative emphasis; it is reserved for ready-to-publish state.
- **Don't** imply that registered inventory is field-ready or that a recommendation is an authorised dispatch.
- **Don't** present the 50% monitoring threshold as incident confirmation or an automatic allocation trigger.
- **Don't** hide unresolved coverage, model blind spots, or capacity pressure to make the plan appear complete.
- **Don't** move methodology ahead of the operational task; keep it accessible through progressive disclosure.
