import { readFile } from "node:fs/promises";
import { createContentClient } from "../lib/sanity/client.js";
import {
  loadPublicPage,
  DEMO_QUERY,
  homeContent,
  cvHeader,
  cvBody,
  contactHtml,
  escapeHtml,
  scriptJson,
} from "../lib/sanity/public-pages.js";
export function createSiteHandler(getClient = createContentClient) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(req.method)) {
      res.setHeader("Allow", "GET, HEAD");
      return res.status(405).end();
    }
    const slug = req.query?.page || "home";
    if (!["home", "cv", "letter", "download"].includes(slug))
      return res.status(404).end();
    try {
      const client = getClient(),
        sourceSlug = ["download", "letter"].includes(slug) ? "cv" : slug,
        page = await loadPublicPage(sourceSlug, client);
      if (!page || (slug !== "download" && !page[sourceSlug]))
        return res
          .status(503)
          .send(
            "This page is temporarily unavailable. Please try again shortly.",
          );
      if (slug === "download") {
        const url = new URL(page.downloadUrl || "https://invalid.local");
        if (
          url.origin !== "https://cdn.sanity.io" ||
          !url.pathname.startsWith("/files/quli96gc/production/")
        )
          return res.status(404).send("CV download unavailable.");
        res.setHeader("Location", url.href);
        return res.status(302).end();
      }
      let html = await readFile(
        new URL(
          `../lib/templates/${slug}.html`,
          import.meta.url,
        ),
        "utf8",
      );
      html = html.replace(
        /<title>[\s\S]*?<\/title>/,
        () => `<title>${escapeHtml(slug === "letter" ? page.cv.name + " · Cover Letter" : page.title)}</title>`,
      );
      if (slug === "home") {
        const identityPage = await loadPublicPage("cv", client);
        if (!identityPage?.cv) throw new Error("Public identity unavailable");
        const content = {
          ...homeContent(page.home),
          identity: {
            name: identityPage.cv.name,
            contactsHtml: contactHtml(identityPage.cv.contacts),
          },
        };
        const demoReport =
          req.query?.demo === "1" ? await client.fetch(DEMO_QUERY) : null;
        html = html.replace(
          "/* SANITY_PUBLIC_CONTENT */",
          () =>
            `window.PUBLIC_CONTENT=${scriptJson(content)};window.PUBLIC_DEMO=${scriptJson(demoReport)};`,
        );
        html = html.replace(
          /<meta name="description"[^>]*>/,
          () =>
            `<meta name="description" content="${escapeHtml(page.description || page.home.introduction?.flatMap((b) => (b.children || []).map((s) => s.text)).join(" ") || "")}" />`,
        );
      } else {
        html = html.replace(
          "/* SANITY_CV_CONTENT */",
          () =>
            `window.PUBLIC_CV=${scriptJson({
              name: page.cv.name,
              signature: (page.cv.contacts || [])
                .filter(
                  (c) =>
                    c.href?.startsWith("mailto:") ||
                    c.href?.includes("linkedin.com/"),
                )
                .map((c) => c.label)
                .join(" · "),
            })};`,
        );
        html = html.replace(
          "<!-- SANITY_CV -->",
          () => cvHeader(page.cv) + cvBody(page.cv),
        );
        if (slug === "letter") html = html.replace("<!-- SANITY_LETTER_HEADER -->", () => cvHeader(page.cv));
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(req.method === "HEAD" ? "" : html);
    } catch {
      res
        .status(503)
        .send(
          "This page is temporarily unavailable. Please try again shortly.",
        );
    }
  };
}
export default createSiteHandler();
