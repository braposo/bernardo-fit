# Personalised CV UX screenshots

The before/after captures show the Documents panel using the same synthetic admin fixture. The baseline HTML is `public/admin.html` at commit `2d6184b437b024d5a9d90094e1b06e2a4b212439`; the after capture uses the working tree. Both runs use `scripts/verify-admin-ux.mjs` API fixtures, job `job0` (Engineering Manager, Example content infrastructure company), stage `interviewing`, one current role-specific CV, one stale fit report, a saved cover letter, interview brief and research. No live API or generation requests are made.

- Admin desktop viewport: 1280 × 900 CSS pixels.
- Admin mobile viewport: 390 × 844 CSS pixels.
- Browser: Playwright bundled Chromium, headless, device scale factor 1.
- Font strategy: requests to Google Fonts (`fonts.googleapis.com` and `fonts.gstatic.com`) are blocked for both baseline and after runs; each waits for `document.fonts.ready` before capture. Both therefore use identical local CSS fallback fonts. Animations, transitions and caret rendering are disabled.

The before/after images capture the Materials panel at full-page height. The before image uses the baseline admin HTML with the same fixtures; after includes the customised CV card and its actions.

The new public personalised fit page is shown in `public-desktop.png` and `public-mobile.png`; it has no before screenshot because this route is new. The captures use the synthetic published Northstar Labs CV fixture at 1280 × 900 and 390 × 844 CSS pixels. The public CV shows the approved headline and saved experience, without a generated summary. `scripts/capture-application-preview.mjs` captures both viewports with Google Fonts blocked, waits for `document.fonts.ready`, and disables animations and transitions for deterministic rendering.
