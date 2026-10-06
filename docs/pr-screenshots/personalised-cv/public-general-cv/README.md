# Public general CV reader comparison

These screenshots compare the legacy `/cv` reader with the new public general-CV renderer using the same fictional CV facts. The legacy data is represented as existing Sanity `cv.sections`; the updated route renders the equivalent structured general-CV content.

- Baseline: `8595d4761261cb7fa7b88c75165204d4b6d7d33a` (`api/site.js` loaded directly from Git).
- Updated: current working tree and `/cv` route.
- Viewports: desktop 1280×900 and mobile 390×844; device scale factor 1.
- Fixture: fictional Alex Morgan, Atlas Systems, Northbridge University, and an accessibility toolkit; reserved example email and UK `020 7946 0018` phone. No live Sanity data or credentials.
- Fonts: Google Fonts are blocked and both renders receive the same forced Arial font after `document.fonts.ready`. Animations, transitions and the caret are disabled.
- The updated reader shows a “Download CV · PDF” link to `/bernardo-raposo-cv.pdf` and “More about my work” footer link to the canonical public site.

Run from the repository root:

```powershell
$env:GENERAL_CV_BASELINE='1'
$env:GENERAL_CV_BASE_REVISION='8595d4761261cb7fa7b88c75165204d4b6d7d33a'
node scripts/capture-general-cv-preview.mjs
Remove-Item Env:GENERAL_CV_BASELINE
node scripts/capture-general-cv-preview.mjs
```

`tests/test-general-cv-public.mjs` exercises the actual `/cv` route and general PDF renderer, checks evidence/private metadata filtering, canonical links and ordered one-page PDF text, and verifies mobile reflow at 390px and 360px.
