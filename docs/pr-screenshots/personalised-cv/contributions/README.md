# Contribution section comparison

Baseline: `db652de42a47cd44811a1ab6235ac1ff52922f83`. Updated: the implementation committed with these images.

The same fictional Alex Morgan / Northstar Labs application uses three grouped contribution entries in both captures. This isolates the section heading and link rendering changes; the real-source grouping and career context migration are checked separately.

Desktop viewport: 1280 x 900. Mobile viewport: 390 x 844. Device scale factor 1, full-page captures from the top. Google Fonts requests are blocked consistently; rendering waits for document.fonts.ready, with animations, transitions and caret disabled. All four captures were visually inspected.

The baseline ignores supplied contribution links. The updated page renders the same approved fixture links beneath the Open source summary. Contact details are fictional.

Reproduce with scripts/capture-application-preview.mjs using APP_PREVIEW_STAGE=contributions and APP_PREVIEW_BASE_REVISION=db652de42a47cd44811a1ab6235ac1ff52922f83; set APP_PREVIEW_BASELINE=1 for before, then unset it for after.
