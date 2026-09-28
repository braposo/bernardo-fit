# Public pages in Sanity

The home and CV documents live under **Site page / CV** in the standalone Studio.
Publish edits to make them available on the next page request; drafts stay private.

- **home → Homepage:** name, heading, introduction, submit label, placeholder, hint and contact links.
- **cv → CV layout:** name, headline, contact links and ordered sections/items. Role items support dates, location and rich text. Keep content within the existing A4 page; the printable page warns when it overflows.
- **cv → Downloadable document:** the PDF served by the existing `/bernardo-raposo-cv.pdf` link. Replace this asset when updating the downloadable PDF. Editing CV layout text does not regenerate a PDF automatically.
- The imported **demo** fit report supplies homepage demo mode through a fixed public field projection. Its private sharing setting remains unchanged.

`/`, `/index`, `/cv`, `/cv.html`, `/letter`, `/letter.html` and the existing PDF URL are routed through `api/site.js`. HTML shells retain styles and interaction code; published Sanity fields supply content. The standalone letter and combined document use the same CV identity; the token-protected letter API still controls access to saved letter bodies. Fit reports show the CV's public contact and travel details near the download action. Requests use the server-only viewer token (or the existing editor token as fallback), no CDN content cache, and `Cache-Control: no-store`. Missing/unavailable content gives a retryable 503 rather than silently serving stale source copy. Public queries exclude candidate evidence, recovery payloads, internal assessments and private generation metadata.

## Keep the CV and PDF aligned

Keep the master CV to one page by editing its source, not shrinking the font. Export the same source with the shared template:

```sh
node --env-file=.env.local scripts/export-cv.mjs --output output/pdf/bernardo-raposo-cv.pdf
```

This requires Playwright Chromium (`npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an installed Chromium browser) and access to the document fonts. For a local content proposal, supply `--source path/to/public-cv-site-page.json`. The script is read-only against Sanity. It checks print overflow and font loading and writes a PDF plus a source/PDF hash manifest. It never generates, uploads or publishes application documents.

Before replacing `download.asset`, inspect the rendered PDF, confirm exactly one A4 page and verify selectable text and links. Check the manifest's source hash against the CV fields being published. Publish the CV content and the new asset reference together with a revision guard; preserve the previous reference for rollback. Generated exports and private content snapshots stay out of Git.

The published Analysis settings cover prompt controls preferred letter length and optional `fitLinkText`. Normalisation appends a link only when that field contains text and the app supplies a valid HTTP(S) URL. It never adds promotional copy by itself. Existing saved letters remain unchanged. Deploy the matching Vercel app and Production worker version before using the revised generation path.

The existing documents were enriched with layout fields using the standalone Studio's `scripts/structure-public-pages.mjs`. It checks the imported body against the original snapshot, refuses drafts, backs up documents and applies revision guards. The original flattened body remains archived. The script skips documents already converted.

Standalone Studio changes are included for review in `migration/public-pages-studio.patch`; apply only to the sibling Studio at commit `fa711dd`. The Studio remains a separate repository.
