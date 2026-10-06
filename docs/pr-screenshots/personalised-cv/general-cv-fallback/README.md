# General CV fallback in the admin Documents card

This comparison shows the Documents card when a job has no valid saved or live customised CV and a published general CV is available.

- Baseline admin UI: `8595d4761261cb7fa7b88c75165204d4b6d7d33a` (`public/admin.html` loaded directly from Git).
- Updated UI: current working tree.
- Viewports: desktop 1280×900 and mobile 390×844; device scale factor 1.
- Fixture: the same synthetic Example Infrastructure Company role, no job-specific CV, and an available general CV at `/bernardo-raposo-cv.pdf`.
- Fonts: Google Fonts requests are blocked; captures wait for `document.fonts.ready`, so both use the same local fallback fonts. Animations, transitions and the caret are disabled.
- The updated card says “No customised CV yet”, provides the separately labeled “Download general CV” action, and retains “Generate CV” for role-specific generation. It does not show tailored Open or Download actions.

Run from the repository root in PowerShell:

```powershell
$env:ADMIN_UX_CAPTURE_ONLY='1'
$env:ADMIN_UX_CV_GENERAL_FALLBACK='1'
$env:ADMIN_UX_SCREENSHOTS='docs/pr-screenshots/personalised-cv/general-cv-fallback'
$env:ADMIN_UX_BASE_REVISION='8595d4761261cb7fa7b88c75165204d4b6d7d33a'
$env:ADMIN_UX_BASELINE='1'
node scripts/verify-admin-ux.mjs
Remove-Item Env:ADMIN_UX_BASELINE
node scripts/verify-admin-ux.mjs
```
