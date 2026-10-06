# Projects & speaking label comparison

This pair isolates the visible section heading change in the public Application CV and PDF renderer. The base is commit `84cb6c3c97b144e8d990612c88af78809b1cb3b4`; after is the current working tree.

Both captures use the same fully synthetic Northstar Labs report and fictional Alex Morgan CV at 1280 × 900 and 390 × 844 CSS pixels. The CV includes two distinct entries under `projects`: an open-source accessibility toolkit and a conference talk. The base calls the section “Projects”; after calls it “Projects & speaking”. Data splitting is handled separately by the CV source/seed migration.

Both runs use Playwright bundled Chromium, headless, device scale factor 1. Google Fonts are blocked; the script awaits `document.fonts.ready` and disables animations, transitions and caret rendering. No Sanity credentials or AI calls are used.

Capture with:

```powershell
$env:APP_PREVIEW_STAGE='projects-speaking'
$env:APP_PREVIEW_BASELINE='1'
$env:APP_PREVIEW_BASE_REVISION='84cb6c3c97b144e8d990612c88af78809b1cb3b4'
node scripts/capture-application-preview.mjs
$env:APP_PREVIEW_BASELINE=''
node scripts/capture-application-preview.mjs
```
