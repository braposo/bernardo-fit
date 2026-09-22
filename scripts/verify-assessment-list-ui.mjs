import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const files = new Set(["/admin.html", "/admin-run.js", "/admin-usage.js", "/assets/admin-ui.js", "/assets/admin-ui.css"]);
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (!files.has(pathname)) return res.writeHead(404).end();
  res.setHeader("Content-Type", pathname.endsWith(".js") ? "text/javascript" : pathname.endsWith(".css") ? "text/css" : "text/html");
  res.end(await readFile(new URL("../public" + pathname, import.meta.url)));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => sessionStorage.setItem("bfit_admin_secret", "fixture"));
  const jobs = [
    { id: "one", company: "Alpha", role: "Lead", stage: "reviewing", fitReportId: "fit-one" },
    { id: "two", company: "Beta", role: "Engineer", stage: "reviewing", fitReportId: "" },
    { id: "three", company: "Gamma", role: "Manager", stage: "new", fitReportId: "" },
  ].map((job) => ({ ...job, jobDescription: "A complete role description for this fixture.", hasDescription: true,
    score: 60, createdAt: "2026-09-20T00:00:00Z", questions: [] }));
  const reviews = [];
  let dispatches = 0;
  let runKind = "";
  const page = await context.newPage();
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postDataJSON();
    const reply = (json, status = 200) => route.fulfill({ status, json });
    if (url.pathname === "/api/admin/jobs") {
      if (url.searchParams.has("q")) return reply({ matchingIds: jobs.filter((job) =>
        (job.company + " " + job.role).toLowerCase().includes(url.searchParams.get("q").toLowerCase())).map((job) => job.id) });
      if (url.searchParams.has("id")) return reply({ job: jobs.find((job) => job.id === url.searchParams.get("id")) });
      return reply({ jobs: jobs.map(({ jobDescription, overviewSummary, ...job }) => job),
        stages: ["new", "reviewing"], archiveOnStage: [], features: { jevEnabled: true } });
    }
    if (url.pathname === "/api/admin/cover" && body?.action === "review") {
      reviews.push(body);
      return reply({ review: { kind: body.kind, effectiveKind: body.kind, model: "jev-1.13.0", fingerprint: "reviewed",
        jobs: body.jobIds?.map((id) => jobs.find((job) => job.id === id)) || [], submitLabel: "Assess roles",
        description: "Assess the selected roles and write summaries." } });
    }
    if (url.pathname === "/api/admin/cover" && request.method() === "POST") {
      dispatches++;
      runKind = body.kind;
      if (["jev-score", "jev-score-all"].includes(body.kind)) {
        for (const job of jobs.filter((item) => body.jobIds?.includes(item.id) || item.id === body.id)) {
          job.score = 82;
          job.jevAssessment = { fingerprint: "same", assessedAt: "2026-09-22", score: 82, dimensions: [] };
          job.overviewSummary = { fingerprint: "same", assessedAt: "2026-09-22", position: "Fresh position summary.", fit: "Fresh fit summary." };
        }
      }
      return reply({ runId: "run-one" }, 202);
    }
    if (url.pathname === "/api/admin/cover" && request.method() === "GET") {
      return reply({ kind: runKind, status: "COMPLETED", terminal: true,
        result: { outcome: "completed", assessed: 2, failed: 0 } });
    }
    return reply({ error: "Unexpected fixture request" }, 404);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/admin.html?job=one`);
  await page.locator("#stagefilter").selectOption("reviewing");
  await page.getByRole("button", { name: "Assess listed roles (2)" }).click();
  await page.locator("[data-review-submit]:enabled").waitFor();
  assert.deepEqual(new Set(reviews.at(-1).jobIds), new Set(["one", "two"]));
  assert.equal(reviews.at(-1).kind, "jev-score-all");
  assert.equal(await page.locator("[data-review-model]").count(), 0);
  await page.keyboard.press("Escape");
  assert.equal(dispatches, 0);
  await page.getByRole("button", { name: "Assess listed roles (2)" }).click();
  await page.locator("[data-review-submit]:enabled").click();
  await page.getByText("Fresh position summary.").waitFor();
  assert.equal(jobs[0].fitReportId, "fit-one");
  assert.equal(jobs[1].fitReportId, "");
  assert.equal(dispatches, 1);
  if (process.env.ASSESSMENT_UI_SCREENSHOTS) await page.screenshot({ path: process.env.ASSESSMENT_UI_SCREENSHOTS + "/assessment-desktop.png" });

  await page.locator("#search").fill("Beta");
  await page.getByRole("button", { name: "Assess listed roles (1)" }).click();
  await page.locator("[data-review-submit]:enabled").waitFor();
  assert.deepEqual(reviews.at(-1).jobIds, ["two"]);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-act="back"]').click();
  assert.equal(await page.getByRole("button", { name: "Assess listed roles (1)" }).isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.ASSESSMENT_UI_SCREENSHOTS) await page.screenshot({ path: process.env.ASSESSMENT_UI_SCREENSHOTS + "/assessment-mobile.png" });
  await page.locator("#search").fill("");
  await page.locator("#stagefilter").selectOption("");
  await page.locator('[data-select-job="one"]').click();
  await page.locator('[data-act="jevscore"]').click();
  await page.locator("[data-review-submit]:enabled").click();
  await page.getByText("Fresh position summary.").waitFor();
  assert.equal(await page.getByText("Fresh fit summary.").isVisible(), true);
  assert.equal(dispatches, 2);
  console.log("ok filtered assessment scope, no fit-page generation, mobile layout, and automatic summary refresh");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
