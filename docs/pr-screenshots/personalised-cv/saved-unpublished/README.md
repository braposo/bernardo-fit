# Saved unpublished customised CV

This before/after comparison reproduces a valid private CV version saved without a published live version. It uses the same synthetic job and saved version in both captures, with the Versions panel expanded.

- Baseline admin UI: `db652de42a47cd44811a1ab6235ac1ff52922f83` (`public/admin.html` loaded from Git).
- Updated UI: current working tree.
- Viewports: desktop 1280×900 and mobile 390×844; device scale factor 1.
- Fixture: synthetic Example Infrastructure Company role, version 1, `gpt-5.6-sol`, valid PDF. It has no current or submitted version, but its latest valid private version ID is `cv-v2`.
- Fonts: Google Fonts requests are blocked; the capture waits for `document.fonts.ready`, so both screenshots use the same local fallback fonts. Animations, transitions and the caret are disabled.
- The baseline shows the bug: “Saved” badge alongside “Not generated yet” and no top-level preview/download actions. The updated card says “Saved · not live”, opens and downloads the saved version through the authenticated version-token endpoint, and retains the explicit Publish live action in history.

Run from the repository root in PowerShell:

```powershell
$env:ADMIN_UX_CAPTURE_ONLY='1'
$env:ADMIN_UX_CV_SAVED_UNPUBLISHED='1'
$env:ADMIN_UX_SCREENSHOTS='docs/pr-screenshots/personalised-cv/saved-unpublished'
$env:ADMIN_UX_BASELINE='1'
node scripts/verify-admin-ux.mjs
Remove-Item Env:ADMIN_UX_BASELINE
node scripts/verify-admin-ux.mjs
```

The updated capture also asserts the saved version's preview action requests a token scoped to `cv-v2`.
