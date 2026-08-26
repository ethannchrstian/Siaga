# Overview — Laporan Operasional

## Scope and mode

- **Surface:** `Overview.tsx`, with implementation in `redesign.css`.
- **Mode:** Operate.
- **Form:** focused operations brief (`focused-operations-brief-v1`).
- **Build path:** code-led local extension; no approved comparison comp existed.

## Audience and job

Pusdalops and BPBD operators use this surface to understand the active pre-positioning proposal, see what remains unresolved, validate scarce-resource use, and decide whether the proposal is ready to become an official order. It must never suggest autonomous dispatch.

## Primary task and proof

- **Primary action:** review and publish the proposed order after human validation.
- **Main work surface:** allocation table showing destination, resource, contributing depot, travel time, exposure, approval state, and map action.
- **Validation proof:** fleet use, locked and redirected decisions, remaining units, authorisation gate, and next actions.
- **Secondary work:** follow-up queue for unserved monitored areas, radar escalation, and model blind spots.
- **Audit proof:** hazard condition, process stages, operation identity, decision history, and usage limits behind one disclosure.

## Chosen direction

**Thesis:** Laporan Operasional is a command brief, not a document assembled from equal cards.

**Visual world:** a compact institutional header leads into one navy decision field, cool-white work surfaces, and a narrower validation rail. The field summarizes current plan, remaining priorities, resource commitment, and Pusdalops/BPBD authority. Green appears only for `Siap diterbitkan`; amber appears for `Menunggu persetujuan`.

**Memorable moment:** the first viewport moves in one scan from readiness and the operator’s authority, through four live plan metrics, into allocation work and the review action. The authority statement stays inside the decision field, not in a distant disclaimer.

## Responsive behavior

- At desktop scale, allocation and validation form an unequal two-column workspace.
- Below 1460px, validation follows the allocation surface and may use two columns.
- Below 820px, decision metrics become a 2×2 grid and all work and audit regions stack.
- Below 560px, allocation rows become stacked cards with a full-width map action; the five primary destinations become the mobile command bar; the publish action becomes full-width.
- Follow-up cards reduce from three columns to two, then one.

## Accessibility and semantics

- The command brief, work surface, control rail, follow-up queue, and audit disclosure have explicit landmarks and accessible labels.
- Capacity tracks use `role="progressbar"` plus minimum, maximum, current, and readable value text.
- Buttons, links, and the audit summary share a visible focus treatment.
- Motion is limited to small state changes and is removed under `prefers-reduced-motion`.
- The 2015 view is labeled as an in-sample allocation stress test and not real time; 2023 onward is labeled out-of-sample.

## Constraints for future changes

- Preserve the reading order: status and authority → allocation → validation → follow-up → audit.
- Keep the allocation table as the desktop work surface; do not replace it with a KPI-card grid.
- Keep the publication gate tied to human validation of road access, depot readiness, crews, and provincial support.
- Keep registered inventory distinct from confirmed readiness, and recommendations distinct from official orders.
- Keep audit detail accessible without making it compete with the active operational task.

## Unresolved decisions

- Whether future publishing will require a formal multi-step approval record beyond the current lock state.
- Whether live readiness, route, crew, fuel, or provincial-support feeds will become available; do not design them as confirmed facts until product truth changes.
