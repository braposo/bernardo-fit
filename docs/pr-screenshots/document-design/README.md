# Public document design refresh

Captured with `scripts/capture-document-design.mjs` using the same synthetic candidate (Alex Morgan), role, report and letter for both revisions.

- Before: base `0d5a74d` (`node scripts/capture-document-design.mjs before`, run before the change).
- After: this branch (`node scripts/capture-document-design.mjs after`).
- Viewports: fit page 1280×900 and 390×844 (full page); application CV in print media at A4 (794×1123); general CV reader 390×844; cover letter 1280×1200 and 390×844.
- Chromium headless, deviceScaleFactor 1, reduced motion, animations disabled, fonts loaded from Google Fonts (the PDF renderer uses its bundled fonts).
