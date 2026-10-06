# White CV page without separators

Base: `8235830e414e35c262b1011d7550ae534d8fe016`.
After: the `codex/cv-white-sections` implementation committed with these captures.

Run `node scripts/capture-cv-white-sections.mjs before` on the base renderer, then `node scripts/capture-cv-white-sections.mjs after` on the changed renderer.

Both captures use the same synthetic Alex Morgan fixture, bundled fonts, Chromium, device scale 1, reduced motion, initial scroll position, and settled font painting. Viewports: 1280×1200, 768×1024, 390×844, 360×844, and 794×1123 in print media. Full-page images may be taller than the viewport. No private CV content is included.

The recorded header, section and footer geometry is identical before and after at all five sizes. Focused public-CV, renderer and refresh tests pass. The synthetic and actual published CV content both render as validated single-page A4 PDFs. The live saved PDF is not changed by this PR; after release, run the documented general CV refresh to publish the new renderer version.

The final design has no horizontal separators. Project-content verification additionally covers Fit, Hermans Club immediately below it, the existing open-source links, and three dated Notist links. The updated actual CV was rendered and visually inspected locally; personal-content previews are not committed.
