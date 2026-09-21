# Design decision history

The detailed rules below cover the admin pipeline and selected-job workspace. Public fit pages and document readers retain their existing design and implementation unless a task explicitly changes them; do not apply the admin redesign to them by default.

Use the latest explicit user decision. This file summarizes the current baseline from these saved sources:

- [Approved design and subsequent decisions](admin-ux/approved-design-implementation.md): current layout, document cards, publication, per-version instructions, score gauges and Activity.
- [Component guidance](admin-ux/shadcn-components.md): actual Radix-based shadcn components and rendering boundaries.
- [Original implementation plan](admin-ux-implementation-plan.md): navigation, editing, generation safety and accessibility contracts that still apply.
- [Visual guide](admin-ux/README.md) and [implementation review](admin-ux/pr-6-review.md): earlier illustrations, interaction details and verification scenarios.

Later approved decisions supersede these older proposals:

| Earlier proposal | Current agreed direction |
| --- | --- |
| Plain HTML only for admin controls | React/shadcn component layer using existing Radix primitives |
| Warm paper palette, blue opening actions and amber generation buttons | AdminCN-inspired light palette and shared muted primary actions; retain Sparkles and the nearby AI-cost explanation |
| Materials and Role & context section names | Documents and Role details; preserve existing materials/context URL compatibility |
| Version groups in Activity | Expandable history beside each document |
| Analytics and an Activity shortcut on Overview | Analytics in Activity, followed by audit history and per-job AI usage |
| Input/publication/cost paragraphs in the generation dialog | Optional per-version instructions beneath the model selector, as recorded in the later approved decision |

Older wireframes illustrate intent, not current pixel specifications. Their sample companies, counts, models and annotations must not become production data or copy.
