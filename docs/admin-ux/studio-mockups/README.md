# AdminCN-inspired pipeline design proposal

This is a design-only prototype with illustrative data. It does not change the application or call its APIs.

## Review

Run `node docs/admin-ux/studio-mockups/preview.mjs --serve` and open http://127.0.0.1:4177. Use the top toolbar to switch between the pipeline, focused role page and mobile preview. Search, stage filters, sorting, role navigation and document preview dialogs work with fixtures.

- [Desktop pipeline](01-pipeline.png)
- [Desktop role and documents](02-role-documents.png)
- [Mobile pipeline](03-mobile.png)
- [Mobile role and documents](04-mobile-documents.png)

## Recommended direction

Use a full-width list of distinct, bordered cards with generous spacing. Each card shows a large numeric score without repeated Fit or tier labels, a company and role, a named colored stage, a row of document shortcuts and relative time added. Preserve an accessible score description. Missing documents remain visibly unavailable in the list; generation belongs to an explicit action in the focused role page.

Opening a job shows a dedicated role view. Documents come first, ahead of overview and context sections. Keep the fit page's shareability distinct from private letter, brief and research documents. Opening an existing document never generates another one.

Stage colors: violet Interviewing, blue Applied, teal Reviewing, green Offer, slate New, rose Rejected. Retain stage names and accessible contrast: color must not carry meaning alone. Map these variants to the application's existing status taxonomy when implementing.

On mobile, the score and stage remain prominent, document shortcuts wrap, and document cards use a two-column grid. Relative times should use actual pipeline creation timestamps, with exact dates available on focus/hover and through accessible text.

## shadcn Studio references and implementation map

Reviewed the free [AdminCN repository](https://github.com/shadcnstudio/shadcn-nextjs-admincn-admin-template-free) and its [Orders dashboard demo](https://shadcn-nextjs-admincn-admin-template-free.vercel.app/dashboard/orders).

| Reference / composition | Proposed use | Existing shadcn primitives |
| --- | --- | --- |
| Statistics cards | Large score tile, clear numeric hierarchy | Card, CardContent |
| Mail item layout | Separated job cards, metadata and timestamp row | Card, Button, Badge |
| Sidebar and user identity | Quiet navigation and workspace identity | Sidebar, Avatar, Separator |
| Badges | Consistent named stage colors | Badge variants |
| User detail layouts | Focused role view with document cards first | Card, Tabs |
| Document actions | Explicit open, version and generation actions | Button, DropdownMenu, Dialog, AlertDialog |
| Search and filters | Compact controls with accessible labels | Input, Label, Select or NativeSelect |
| Activity presentation | Recorded events and version outcomes | Semantic list and Separator |

Source references: [statistics card](https://github.com/shadcnstudio/shadcn-nextjs-admincn-admin-template-free/blob/main/src/views/dashboards/statistics/statistics-card-01.tsx), [mail item](https://github.com/shadcnstudio/shadcn-nextjs-admincn-admin-template-free/blob/main/src/views/apps/mail/mail-item.tsx), [badge](https://github.com/shadcnstudio/shadcn-nextjs-admincn-admin-template-free/blob/main/src/components/ui/badge.tsx).

The HTML is original mockup code inspired by these compositions, not an installed template or a production shadcn implementation. The template includes Base UI primitives; our current components use Radix. Reuse the app's shadcn components and adapt the visual compositions instead of mixing primitive implementations. This proposal does not depend on paid Kanban templates.

## Boundaries for implementation

The full-width list and dedicated role view revise the earlier split-panel layout. Sorting and the sample activity timeline are proposed presentation features: use supported fields and recorded events only; do not invent history. Preserve existing dirty-form protection, document versions, generation confirmation and usage visibility. Sidebar destinations and secondary actions in this prototype show explanatory dialogs rather than implementing new features.

Production work should use existing shadcn components, verify keyboard focus and mobile touch targets, and repeat the application's browser/axe checks. The prototype uses semantic native controls to review layout and interaction; it is not a substitute for production accessibility verification.

## Verification

`preview.mjs` renders four screenshots and checks search, filtering, role navigation, document dialogs, Escape dismissal, page errors and horizontal overflow at desktop/mobile sizes. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a local Chrome executable if necessary. No full application test suite is required for these isolated design artifacts.
