# Public pages in Sanity

The home and CV documents live under **Site page / CV** in the standalone Studio.
Publish edits to make them available on the next page request; drafts stay private.

- **home → Homepage:** name, heading, introduction, submit label, placeholder, hint and contact links.
- **cv → CV layout:** name, headline, contact links and ordered sections/items. Role items support dates, location and rich text. Keep content within the existing A4 page; the printable page warns when it overflows.
- **cv → Downloadable document:** the PDF served by the existing `/bernardo-raposo-cv.pdf` link. Replace this asset when updating the downloadable PDF. Editing CV layout text does not regenerate a PDF automatically.
- The imported **demo** fit report supplies homepage demo mode through a fixed public field projection. Its private sharing setting remains unchanged.

`/`, `/index`, `/cv`, `/cv.html` and the existing PDF URL are routed through `api/site.js`. HTML shells retain styles and interaction code; published Sanity fields supply content. Requests use the server-only viewer token (or the existing editor token as fallback), no CDN content cache, and `Cache-Control: no-store`. Missing/unavailable content gives a retryable 503 rather than silently serving stale source copy. Public queries exclude candidate evidence, recovery payloads, internal assessments and private generation metadata.

The existing documents were enriched with layout fields using the standalone Studio's `scripts/structure-public-pages.mjs`. It checks the imported body against the original snapshot, refuses drafts, backs up documents and applies revision guards. The original flattened body remains archived. The script skips documents already converted.

Standalone Studio changes are included for review in `migration/public-pages-studio.patch`; apply only to the sibling Studio at commit `fa711dd`. The Studio remains a separate repository.
