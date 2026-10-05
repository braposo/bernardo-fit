// Exercise public report navigation with synthetic data and no paid generation.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const content = {
  name: "Example candidate", headingHtml: "Assess a role", introductionHtml: "Paste a role",
  placeholder: "Job description", buttonLabel: "Assess fit", hint: "", contactsHtml: "",
  identity: { name: "Example Candidate", contactsHtml: "" },
};
const reports = {
  first: { job_title: "Engineering Manager", company: "Example" },
  duplicate: { job_title: "Engineering Manager", company: "Example" },
  second: { job_title: "Director", company: "Another Company" },
  company: { company: "Example" },
  role: { job_title: "Engineer" },
  missing: { job_title: "  ", company: " " },
  escaped: { job_title: "R&D <Lead>", company: "A & B" },
};
const html = (await readFile(new URL("../lib/templates/home.html", import.meta.url), "utf8"))
  .replace(/<title>.*?<\/title>/, "<title>CMS home title</title>")
  .replace("/* SANITY_PUBLIC_CONTENT */", "window.PUBLIC_CONTENT=" + JSON.stringify(content) + ";");
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: html });
      if (url.pathname === "/assets/task-ui.js") return route.fulfill({ contentType: "text/javascript", body: "export function taskToast() {} export function subscribeRun() {}" });
      if (url.pathname === "/admin-run.js") return route.fulfill({ contentType: "text/javascript", body: "export function createRunWatcher() {} export function coverPhaseText() {}" });
      if (url.pathname === "/api/report") {
        const report = reports[url.searchParams.get("id")];
        return route.fulfill({ status: report ? 200 : 404, json: report ? { report } : { error: "Not found" } });
      }
      return route.fulfill({ status: 200, body: "" });
    });
    const expected = {
      first: "Engineering Manager at Example", duplicate: "Engineering Manager at Example",
      second: "Director at Another Company", company: "Example", role: "Engineer",
      missing: "Fit report", escaped: "R&D <Lead> at A & B",
    };
    for (const [id, context] of Object.entries(expected)) {
      await page.goto("http://fit.test/?r=" + id);
      await page.locator("#new").waitFor();
      assert.equal(await page.title(), `${context} — Fit · Example Candidate · ${id}`);
    }
    await page.locator("#new").click();
    assert.equal(await page.title(), "CMS home title");
    await page.goBack();
    await page.locator("#new").waitFor();
    assert.equal(await page.title(), "R&D <Lead> at A & B — Fit · Example Candidate · escaped");
    await page.goForward();
    await page.locator("#go").waitFor();
    assert.equal(await page.title(), "CMS home title");
    await page.goto("http://fit.test/?r=not-found");
    await page.locator("#go").waitFor();
    assert.equal(await page.title(), "CMS home title");
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("Fit titles verified at desktop and mobile widths, including duplicate roles, fallbacks, escaping, navigation and missing reports.");
} finally {
  await browser.close();
}
