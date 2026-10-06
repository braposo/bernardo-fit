# Public application page: clean layout comparison

These screenshots compare the public personalised application page before and after the whitespace and paragraph presentation update.

- Baseline: `f431d4136feed3be57f3f7b688949faf5e677d9f` (`lib/handlers/application.js` and `lib/templates/application.html` loaded directly from Git).
- Updated: the current working tree.
- Viewports: desktop 1280×900 and mobile 390×844; device scale factor 1.
- Fixture: the same synthetic Alex Morgan application and Northstar Labs fit report for all captures. The phone number is fictional UK example `020 7946 0018`.
- Fonts: Google Fonts requests are blocked in both runs; captures wait for `document.fonts.ready`, so both use the same local fallback fonts. Animations, transitions and the caret are disabled.
- The baseline handler rejects `tel:` links, so its screenshot omits the fixture phone. The updated handler renders the same supplied phone as a clickable contact. Other content and the sole CV download action are identical.

Run from the repository root:

```powershell
$env:APP_PREVIEW_STAGE='clean-layout'
$env:APP_PREVIEW_BASELINE='1'
$env:APP_PREVIEW_BASE_REVISION='f431d4136feed3be57f3f7b688949faf5e677d9f'
node scripts/capture-application-preview.mjs
Remove-Item Env:APP_PREVIEW_BASELINE
node scripts/capture-application-preview.mjs
```

The script writes `public-before-*` and `public-after-*` images here and checks the updated page for removed divider borders, paragraph evidence without list markers, the phone link and exactly one download CTA.
