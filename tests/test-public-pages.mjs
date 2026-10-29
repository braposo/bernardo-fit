import assert from "node:assert/strict";
import {
  richText,
  homeContent,
  homeShowcase,
  cvBody,
  cvHeader,
  scriptJson,
  loadPublicPage,
} from "../lib/sanity/public-pages.js";
import handler from "../api/site.js";
const block = (text, more = {}) => ({
  _type: "block",
  children: [{ text, marks: [] }],
  ...more,
});
let count = 0;
function test(fn) {
  fn();
  count++;
}
test(() => {
  const html = richText([
    block("<script>alert(1)</script>"),
    block("one", { listItem: "bullet" }),
    block("two", { listItem: "bullet" }),
    block("after"),
  ]);
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("<ul><li>one</li><li>two</li></ul><p>after</p>"));
});
test(() =>
  assert.equal(
    richText([
      {
        ...block("link"),
        children: [{ text: "link", marks: ["bad"] }],
        markDefs: [{ _key: "bad", href: "javascript:alert(1)" }],
      },
    ]),
    "<p>link</p>",
  ),
);
test(() =>
  assert.ok(
    !scriptJson({ text: "</script><script>alert(1)</script>" }).includes("<"),
  ),
);
test(() => {
  const cv = {
    name: "A & B",
    headline: "Leader",
    contacts: [{ label: "Contact", href: "mailto:a@example.com" }],
    sections: [
      {
        label: "Experience",
        items: [
          {
            kind: "role",
            title: "Engineer",
            dates: "2020–2026",
            location: "UK",
            body: [block("Built things", { listItem: "bullet" })],
          },
        ],
      },
    ],
  };
  assert.ok(cvHeader(cv).includes("A &amp; B"));
  assert.ok(cvBody(cv).includes('<span class="when">2020–2026</span>'));
  assert.ok(cvBody(cv).includes("<ul><li>Built things</li></ul>"));
});
test(() =>
  assert.equal(
    homeContent({
      heading: [block("Edited heading")],
      introduction: [],
      contacts: [],
    }).headingHtml,
    "Edited heading",
  ),
);
await loadPublicPage("cv", {
  fetch: async (q, p) => {
    assert.deepEqual(p, { slug: "cv" });
    assert.ok(!q.includes("sourcePayload"));
    assert.ok(!q.includes("candidate->"));
    count++;
  },
});
const res = {
  headers: {},
  setHeader(k, v) {
    this.headers[k] = v;
  },
  status(v) {
    this.code = v;
    return this;
  },
  send(v) {
    this.body = v;
    return this;
  },
  end() {
    return this;
  },
};
await handler({ method: "POST", query: {} }, res);
assert.equal(res.code, 405);
count++;
await handler({ method: "GET", query: { page: "private" } }, res);
assert.equal(res.code, 404);
count++;

import { createSiteHandler } from "../api/site.js";
const mockPage = {
  title: "Edited CMS title",
  home: {
    name: "Edited name",
    heading: [block("CMS heading")],
    introduction: [],
    contacts: [],
  },
  cv: {
    name: "Edited name",
    headline: "CMS CV",
    contacts: [],
    sections: [
      {
        label: "Profile",
        items: [{ kind: "text", body: [block("CMS biography")] }],
      },
    ],
  },
  downloadUrl: "https://cdn.sanity.io/files/quli96gc/production/example.pdf",
};
const publicHandler = createSiteHandler(() => ({
  fetch: async () => mockPage,
}));
await publicHandler({ method: "GET", query: { page: "home" } }, res);
assert.equal(res.code, 200);
assert.ok(res.body.includes("CMS heading"));
assert.ok(res.body.includes("<title>Edited CMS title</title>"));
count++;
assert.ok(!res.body.includes('"showcase":{'));
count++;
const showcase = homeShowcase({
  identity: { headline: "Engineering Manager | AI", contacts: [{ label: "+44", href: "tel:+44" }] },
  profile: { paragraphs: ["I lead **teams**. More."], skills: [{ label: "Design", items: ["systems"] }] },
  experience: [{ title: "EM", company: "Co", dates: "2020", location: "Remote | Database", bullets: [{ text: "private", evidenceIds: ["x"] }] }],
  earlier: [{ title: "Junior", company: "Old", dates: "2009", location: "Coimbra", text: "x" }],
  featured: [{ title: "Fit", dates: "2026", scope: "Built it", links: [{ label: "fit", href: "https://fit.example/" }, { label: "bad", href: "javascript:alert(1)" }] }],
  projects: [{ title: "OSS", bullets: [{ text: "Packages" }], links: [] }],
});
assert.deepEqual(showcase.career, [
  { title: "EM", company: "Co", dates: "2020", field: "Database" },
  { title: "Junior", company: "Old", dates: "2009", field: "" },
]);
assert.deepEqual(showcase.featured[0].links, [{ label: "fit", href: "https://fit.example/" }]);
assert.ok(!JSON.stringify(showcase).includes("tel:") && !JSON.stringify(showcase).includes("private"));
assert.equal(homeShowcase({ profile: { paragraphs: [] } }), null);
count++;
await publicHandler({ method: "GET", query: { page: "cv" } }, res);
assert.ok(res.body.includes("CMS biography"));
assert.ok(res.body.includes("CMS CV"));
assert.ok(!res.body.includes("<!-- SANITY_CV -->"));
count++;
await publicHandler({ method: "GET", query: { page: "letter" } }, res);
assert.equal(res.code, 200);
assert.ok(res.body.includes('CMS CV'));
assert.ok(res.body.includes('window.PUBLIC_CV='));
assert.ok(res.body.includes('/api/letter?j='));
assert.ok(!res.body.includes('Hands-On Frontend'));
assert.ok(!res.body.includes('<!-- SANITY_LETTER_HEADER -->'));
assert.ok(!res.body.includes('CMS biography'));
count++;
await publicHandler({ method: "GET", query: { page: "download" } }, res);
assert.equal(res.code, 302);
assert.equal(res.headers.Location, mockPage.downloadUrl);
count++;
mockPage.downloadUrl = "https://evil.example/cv.pdf";
await publicHandler({ method: "GET", query: { page: "download" } }, res);
assert.equal(res.code, 404);
count++;
await createSiteHandler(() => ({
  fetch: async () => {
    throw Error("secret token must not escape");
  },
}))({ method: "GET", query: {} }, res);
assert.equal(res.code, 503);
assert.ok(!res.body.includes("secret"));
assert.equal(res.headers["Cache-Control"], "no-store");
count++;

console.log(`passed ${count}, failed 0`);
