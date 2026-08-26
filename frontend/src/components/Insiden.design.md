# Pemantauan Wilayah — Monitoring Triage Register

## Scope and mode

- **Surface:** `Insiden.tsx`, with visual implementation in `redesign.css` and inline stroke support from `icons.tsx`.
- **Mode:** Operate.
- **Form:** focused monitoring register (`monitoring-triage-register-v1`).
- **Build path:** shipped local extension of the established Calm Command Brief; no visual-world replacement.

## Audience and job

BPBD and Pusdalops operators use this surface to compare monitored kecamatan, isolate hazard or coverage subsets, inspect evidence and exposure, and open one district for attributable detail or map review. The screen must make monitoring distinct from allocation: a district crossing the 50% visual monitoring threshold is not thereby a confirmed incident, an automatic allocation target, or an authorised dispatch.

## Primary task and proof

- **Primary task:** narrow and compare the monitored register, then open the district that needs evidence review.
- **Primary proof:** flood probability for the next 0–72 hours, water-stress probability for the following month, estimated exposure, plan coverage, radar blind spots, and model coverage exceptions.
- **Allocation proof:** districts already represented in the current plan show attributable resource assignments; districts not represented remain visibly open for follow-up rather than disappearing.
- **Navigation proof:** operators can open district detail in place or continue to the map without losing the meaning of the current evidence.

## Shipped direction

**Thesis:** Pemantauan Wilayah is a triage register, not an incident dashboard and not an allocation screen.

**Calm Command Brief extension:** a concentrated navy monitoring statement names the active coverage problem and places `Sudah masuk rencana` beside `Belum masuk rencana`. The cyan balance track and planned count describe current plan state only. The open count uses a muted warning red, while the surrounding language explicitly prevents either color from implying field readiness, incident confirmation, or allocation authority.

**Continuous work surface:** one cool-white register contains its heading, live result count, evidence legend, search and filters, active filters, sortable records, pagination, and selected-district detail. This replaces the former impression of independent dashboard cards with one bounded operational sequence.

**Memorable moment:** selecting a scope such as Majemuk, Banjir, Cekaman, Belum masuk rencana, Titik buta, or Di luar model updates the navy command statement, register title, result count, and records together. The scope rail and register read as synchronized views of the same operational state.

## Scope and plan-state semantics

- `Semua`, `Majemuk`, `Banjir`, and `Cekaman` describe monitored evidence subsets.
- `Belum masuk rencana` describes monitoring coverage relative to the current pre-positioning plan; it does not mean ignored or rejected.
- `Titik buta` exposes coastal radar/model blind spots that may sit below the 50% modeled threshold.
- `Di luar model` exposes districts without modeled forecast coverage and must never be treated as safe by absence.
- Flood blue, water-stress red, and compound purple remain hazard identity colors. Cyan is reserved here for planned share within the command field, not for hazard severity or authorisation.

## Responsive behavior

- At desktop scale, the command statement uses an unequal split between explanatory copy and the planned/open balance. The scope rail stays compact above the register, and district comparison remains a table.
- Below 900px, the command field stacks; the plan balance moves below the statement; the register header and controls wrap without separating from the register.
- Below 560px, table headers are hidden and each row becomes a labeled two-column record card. Region, plan coverage, and the detail action span the full card width; evidence, exposure, and plan meaning remain explicit through inline labels.
- The mobile scope rail is a fixed-height, single-line viewport. Its scrollbar is fully hidden, direct horizontal pointer/touch dragging is supported, normal vertical page panning remains available, and a right-edge fade indicates additional off-screen scopes.
- Mobile records never require horizontal table scrolling. Pagination and row actions remain touch-sized and visible.

## Accessibility and semantics

- The command statement and register use explicit heading relationships through `aria-labelledby`.
- The plan balance is a labeled definition list; its decorative fill track is hidden from assistive technology because the numeric planned/open values carry the meaning.
- The scope rail is a labeled navigation landmark, and every scope control exposes selection with `aria-pressed`.
- Risk bars expose `role="progressbar"`, a hazard-specific accessible label, and minimum, maximum, and current values.
- Sortable headers publish `aria-sort`; previous/next pagination and close-detail icon buttons have explicit accessible names.
- On phones, every visually transformed table cell retains a visible semantic label rather than relying on column position.
- Interactive controls share the visible three-pixel focus treatment, and row transition motion is removed under `prefers-reduced-motion`.

## Constraints for future changes

- Preserve the explicit monitoring-versus-allocation distinction in both the threshold note and the dynamic command copy.
- Keep the planned/open comparison inside the command statement, with cyan limited to plan-state meaning.
- Keep scope, command copy, register title, result count, and rows synchronized from one filter state.
- Keep the desktop table and labeled mobile record cards as two intentional presentations of the same dataset.
- Preserve the scrollbar-free mobile drag rail and its overflow cue; do not reintroduce a visible scrollbar or horizontal table overflow.
- Keep blind spots and unmodeled districts reachable as first-class scopes even when they do not enter the normal thresholded register.
- Keep district detail, provenance, and map navigation inside the continuous register workflow.

## Finish disposition

**Ship.** The finish review found no material fixes remaining. The implementation delivers the approved Calm Command Brief extension, preserves functional filtering, sorting, pagination, detail, and map navigation behavior, and meets the intended desktop, mobile, and semantic accessibility contract.

## Unresolved decisions

None for this shipped pass.
