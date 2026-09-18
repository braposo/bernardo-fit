# Admin shadcn component layer

The follow-up request to use shadcn supersedes the original plan's plain-HTML-only rendering constraint for the admin. The existing API, run lifecycle and controller state remain in `public/admin.html`. Public fit pages and document readers retain their existing implementation.

## Components in use

The official shadcn CLI added the Radix/new-york source components under `src/admin/components/ui/`, configured by root `components.json`.

| Admin surface | shadcn component |
| --- | --- |
| Actions, links and pipeline selection | Button; custom `generation` variant with Lucide Sparkles |
| Search, context/question editors and per-version instructions | Input, Textarea, Label |
| Stage filters, role stage and generation model | NativeSelect / NativeSelectOption |
| Economy answer preference | Checkbox |
| Workspace section navigation | Tabs, TabsList, TabsTrigger, TabsContent |
| Generation review and usage | Dialog, DialogContent, DialogTitle, DialogDescription |
| Permanent deletion and question removal | AlertDialog with explicit Cancel and destructive action |
| Errors, stale/reply notices | Alert |
| Attention and active-version indicators | Badge |
| Usage breakdown | Table and its header/body/row/cell components |
| Job header, document cards, authentication and loading | Card, Skeleton |
| Inline document history | Collapsible, CollapsibleTrigger, CollapsibleContent |
| Icon-only status editing | Popover, PopoverTrigger, PopoverContent with NativeSelect |

NativeSelect is an official shadcn control. It deliberately retains native select behavior and mobile pickers. Text links, headings and structural layout do not require interactive primitives. The approved AdminCN-inspired light palette uses shared tokens, separated cards, right-aligned score tiles, named color-coded stages, and muted primary actions. Sparkles and the adjacent cost explanation distinguish generation. The template compositions are adapted to the existing Radix-based shadcn components; no Base UI migration or paid template is introduced.

## Rendering boundary

`src/admin/ui.jsx` is an incremental migration boundary. It converts the controller's existing escaped templates to actual React/shadcn components; it does not merely copy shadcn class names onto raw HTML. Native controller event handlers continue to perform saves, generation reviews and navigation. Radix handles tab keyboard behavior, dialog focus trapping, Escape and modal background isolation.

Each rendered view is a complete snapshot. Dispose nested React roots before replacing a parent snapshot, and never reconcile a snapshot whose descendants the controller has mutated. The existing focused-editor guard prevents background updates from replacing active editors. New standalone interactions should be authored directly as React/shadcn components, as the confirmation dialog already is, rather than extending template parsing indefinitely.

Template input must remain application-owned and escaped. Do not pass arbitrary provider HTML into this renderer. Version content continues to escape output before rendering, and source URLs remain HTTP(S)-only.

## Build and verification

```sh
npm ci
npm run build
npx playwright install chromium
npm run test:admin-ui
```

`npm run build` bundles the admin component entry with esbuild and generates its Tailwind stylesheet into ignored `public/assets/admin-ui.*` files. Run it before serving the local static admin. Vercel and GitHub Actions run this build automatically. API functions and Trigger tasks keep their existing build paths.

`npm run test:admin-ui` uses synthetic data and intercepted API calls. Its 55 checks cover component usage, draft preservation, read-versus-generate boundaries, focus trapping/return, tabs, destructive cancellation, checkbox behavior, independent scrolling and widths of 1280, 768, 390 and 360 pixels. Axe scans Overview, context, usage, generation/answer reviews, destructive confirmation and mobile Documents for WCAG 2 A/AA and 2.1 AA violations. Automated scans supplement the keyboard and visual checks; they do not establish complete accessibility conformance.

`PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select installed Chrome. `ADMIN_UX_SCREENSHOTS` optionally points to an existing screenshot directory. Full Node regression coverage remains authoritative in PR CI.
