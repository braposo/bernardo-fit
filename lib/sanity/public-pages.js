import groq from "groq";
import { createContentClient } from "./client.js";
export const PUBLIC_PAGE_QUERY = groq`*[_type == "sitePage" && slug.current == $slug][0]{
  title, description,
  home{name, heading, introduction, buttonLabel, placeholder, hint, contacts[]{label, href}},
  cv{name, headline, contacts[]{label, href}, sections[]{label, items[]{kind, title, dates, location, body}}},
  "downloadUrl": download.asset->url
}`;
export const DEMO_QUERY = groq`*[_type == "fitReport" && legacyId == "demo"][0]{
  "job_title": jobTitle, company, pitch, categories[]{name, note},
  differentiators[]{headline, detail}, closing
}`;
export const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
export const safeUrl = (value) =>
  /^(https?:\/\/|mailto:)/i.test(value || "") ? value : "";
export function inline(block) {
  return (block.children || [])
    .map((span) => {
      let text = escapeHtml(span.text).replaceAll("\n", "<br>");
      for (const mark of span.marks || []) {
        if (mark === "strong" || mark === "em")
          text = `<${mark}>${text}</${mark}>`;
        const link = (block.markDefs || []).find((d) => d._key === mark);
        if (link && safeUrl(link.href))
          text = `<a href="${escapeHtml(link.href)}" rel="noopener">${text}</a>`;
      }
      return text;
    })
    .join("");
}
export function richText(blocks = []) {
  let result = "",
    list = "";
  for (const block of blocks) {
    if (block._type !== "block") continue;
    const next =
      block.listItem === "bullet"
        ? "ul"
        : block.listItem === "number"
          ? "ol"
          : "";
    if (list !== next) {
      if (list) result += `</${list}>`;
      if (next) result += `<${next}>`;
      list = next;
    }
    const tag = next ? "li" : /^h[1-6]$/.test(block.style) ? block.style : "p";
    result += `<${tag}>${inline(block)}</${tag}>`;
  }
  return result + (list ? `</${list}>` : "");
}
export const contactHtml = (contacts) =>
  (contacts || [])
    .map((c, i) =>
      safeUrl(c.href)
        ? `<a href="${escapeHtml(c.href)}" rel="noopener">${escapeHtml(c.label)}</a>`
        : `<span${i > 0 ? ' class="status"' : ""}>${escapeHtml(c.label)}</span>`,
    )
    .join(" ");
export function cvHeader(cv) {
  return `<header><h1>${escapeHtml(cv.name)}<span class="dot">.</span></h1><p class="headline">${escapeHtml(cv.headline)}</p><div class="contact">${contactHtml(cv.contacts)}</div></header>`;
}
export function cvBody(cv) {
  return `<div class="body">${(cv.sections || []).map((s) => `<section><div class="label">${escapeHtml(s.label)}</div><div class="content">${(s.items || []).map((item) => (item.kind === "role" ? `<div class="role"><div class="role-head"><span>${escapeHtml(item.title)}</span><span class="when">${escapeHtml(item.dates)}</span></div><p class="role-where">${escapeHtml(item.location)}</p>${richText(item.body)}</div>` : item.kind === "skill" ? `<div class="skill">${(item.body || []).map(inline).join("<br>")}</div>` : richText(item.body))).join("")}</div></section>`).join("")}</div>`;
}
export function homeContent(home) {
  return {
    ...home,
    headingHtml: (home.heading || []).map(inline).join("<br>"),
    introductionHtml: (home.introduction || []).map(inline).join("<br><br>"),
    contactsHtml: contactHtml(home.contacts),
  };
}
export async function loadPublicPage(slug, client = createContentClient()) {
  return client.fetch(PUBLIC_PAGE_QUERY, { slug });
}
export const scriptJson = (value) =>
  JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
