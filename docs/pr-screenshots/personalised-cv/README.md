# Personalised CV UX screenshots

## Admin CV actions

The before/after captures show the Documents panel using the same synthetic admin fixture. The baseline HTML is `public/admin.html` at commit `2d6184b437b024d5a9d90094e1b06e2a4b212439`; the after capture uses the working tree. Both runs use `scripts/verify-admin-ux.mjs` API fixtures, job `job0` (Engineering Manager, Example content infrastructure company), stage `interviewing`, one current role-specific CV, one stale fit report, a saved cover letter, interview brief and research. No live API or generation requests are made.

- Desktop viewport: 1280 × 900 CSS pixels.
- Mobile viewport: 390 × 844 CSS pixels.
- Browser: Playwright bundled Chromium, headless, device scale factor 1.
- Font strategy: requests to Google Fonts (`fonts.googleapis.com` and `fonts.gstatic.com`) are blocked for both baseline and after runs; each waits for `document.fonts.ready` before capture. Both therefore use identical local CSS fallback fonts. Animations, transitions and caret rendering are disabled.

The admin images capture the Materials panel at full-page height. The before image uses the baseline admin HTML with the same fixtures; after includes the customised CV card and its actions.

## Public application page

The public before/after pair compares base commit `146d45cb582a1032860f99806352fc648face5aa` with the working tree using the same synthetic Northstar Labs report and fictional Alex Morgan CV. Before shows the report-level download and closing text; after flows from the fit pitch through the supplied fit categories and “What I bring” into the Application CV, with the sole download action beside that CV.

- Desktop viewport: 1280 × 900 CSS pixels.
- Mobile viewport: 390 × 844 CSS pixels.
- Browser: Playwright bundled Chromium, headless, device scale factor 1.
- Font strategy: `scripts/capture-application-preview.mjs` blocks Google Fonts, waits for `document.fonts.ready`, and disables animations, transitions and caret rendering for both revisions.

Use `public-before-desktop.png` and `public-after-desktop.png` for the desktop comparison, and `public-before-mobile.png` and `public-after-mobile.png` for mobile. `public-desktop.png` and `public-mobile.png` mirror the after captures for existing references.
