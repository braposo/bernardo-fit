// Browser check for adding a role from a pasted LinkedIn job link. Serves the
// admin with fixture API responses, pastes a link into the search box, adds it,
// and checks a link already saved opens that role instead. Set
// LINK_UI_SCREENSHOTS=<dir> to save desktop and mobile captures.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const files = new Set(["/admin.html", "/admin-run.js", "/admin-usage.js", "/pipeline-board.js", "/pipeline-insights.js",
  "/linkedin-job-link.js", "/assets/admin-ui.js", "/assets/admin-ui.css", "/assets/task-ui.js", "/task-ui.css"]);
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (!files.has(pathname)) return res.writeHead(404).end();
  res.setHeader("Content-Type", pathname.endsWith(".js") ? "text/javascript" : pathname.endsWith(".css") ? "text/css" : "text/html");
  try { res.end(await readFile(new URL("../public" + pathname, import.meta.url))); } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const shots = process.env.LINK_UI_SCREENSHOTS;
const NEW_LINK = "https://uk.linkedin.com/jobs/view/engineering-manager-at-gitlab-4484959226?trk=public_jobs_topcard-title";

function fixtureJobs() {
  return [
    { id: "one", company: "Deliveroo", role: "Engineering Manager - Unified Platform", stage: "new", score: 74,
      sourceUrl: "https://www.linkedin.com/jobs/view/4484583428", externalId: "linkedin-4484583428" },
    { id: "two", company: "Dex", role: "Engineering Team Lead (AI/Agents)", stage: "reviewing", score: 81 },
  ].map(job => ({ ...job, location: "London", createdAt: "2026-11-20T09:00:00Z", hasDescription: true, questions: [] }));
}

async function open(browser, viewport, link) {
  const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
  await context.addInitScript(() => sessionStorage.setItem("bfit_admin_secret", "fixture"));
  const page = await context.newPage();
  const jobs = fixtureJobs(), posts = [];
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url());
    const reply = (json, status = 200) => route.fulfill({ status, json });
    if (url.pathname === "/api/admin/jobs" && request.method() === "POST") {
      const body = request.postDataJSON(); posts.push(body);
      if (body.action !== "add-linkedin") return reply({ error: "Unexpected" }, 400);
      if (body.url.includes("4484583428")) return reply({ existing: jobs.find(job => job.id === "one") });
      const job = { id: "ing_link", company: "LinkedIn", role: "Job 4484959226", stage: "new", source: "LinkedIn link",
        sourceUrl: "https://www.linkedin.com/jobs/view/4484959226", createdAt: "2026-11-24T13:00:00Z", questions: [],
        jevRun: { runId: "run_link", requestId: "moved-x", status: "queued" } };
      jobs.unshift(job);
      return reply({ job });
    }
    if (url.pathname === "/api/admin/jobs") {
      if (url.searchParams.has("q")) return reply({ matchingIds: [] });
      if (url.searchParams.has("id")) return reply({ job: jobs.find(job => job.id === url.searchParams.get("id")) || {} });
      if (url.searchParams.has("emailProposals")) return reply({ items: [] });
      return reply({ jobs, stages: ["new", "reviewing", "applied"], archiveOnStage: [], features: { jevEnabled: true }, activeCount: jobs.length, filteredCount: 0, archivedCount: 0 });
    }
    if (url.pathname === "/api/admin/cover" && url.searchParams.get("realtime") === "1") return reply({ error: "No realtime" }, 404);
    if (url.pathname === "/api/admin/cover") return reply({ kind: "filtered-enrich", status: "EXECUTING", terminal: false, phase: "fetching" });
    return reply({});
  });
  await page.goto(`${base}/admin.html?collection=jobs${link ? "&q=" + encodeURIComponent(link) : ""}`);
  await page.locator("#search").waitFor();
  return { page, context, posts };
}

const browser = await chromium.launch({ headless: true });
try {
  // Desktop: paste a new link, see the offer, add it.
  const desktop = await open(browser, { width: 1280, height: 860 });
  assert.equal(await desktop.page.locator("#search").getAttribute("placeholder"), "Search roles or paste a LinkedIn job link");
  await desktop.page.locator("#search").fill(NEW_LINK);
  const add = desktop.page.getByRole("button", { name: "Add to pipeline" });
  await add.waitFor();
  await desktop.page.getByText("This LinkedIn job isn’t in your pipeline yet.").waitFor();
  if (shots) await desktop.page.screenshot({ path: `${shots}/link-offer-desktop.png` });
  // Same 44px Button box as the rest of the list controls.
  const [addBox, searchBox] = await Promise.all([add.boundingBox(), desktop.page.locator("#search").boundingBox()]);
  assert.equal(Math.round(addBox.height), Math.round(searchBox.height), "the add button matches the search box height");
  await add.click();
  await desktop.page.waitForFunction(() => new URLSearchParams(location.search).get("job") === "ing_link");
  assert.equal(desktop.posts[0].url, NEW_LINK);
  assert.equal(await desktop.page.locator("#search").inputValue(), "");
  await desktop.page.getByText("Adding LinkedIn job").first().waitFor();
  if (shots) await desktop.page.screenshot({ path: `${shots}/link-added-desktop.png` });

  // A link already saved opens that role rather than adding another.
  await desktop.page.locator("#search").fill("https://www.linkedin.com/jobs/view/4484583428/?refId=abc");
  await desktop.page.getByRole("button", { name: "Add to pipeline" }).click();
  await desktop.page.waitForFunction(() => new URLSearchParams(location.search).get("job") === "one");
  await desktop.page.getByText("Already in your pipeline").first().waitFor();
  await desktop.context.close();

  // Mobile: a link opened with ?q= offers to add it.
  const mobile = await open(browser, { width: 390, height: 844 }, NEW_LINK);
  await mobile.page.getByRole("button", { name: "Add to pipeline" }).waitFor();
  if (shots) await mobile.page.screenshot({ path: `${shots}/link-offer-mobile.png` });
  await mobile.context.close();

  // /admin?add=<link> adds straight away (for a share sheet or shortcut).
  const sent = await open(browser, { width: 390, height: 844 });
  await sent.page.goto(`${base}/admin.html?add=${encodeURIComponent(NEW_LINK)}`);
  await sent.page.waitForFunction(() => new URLSearchParams(location.search).get("job") === "ing_link");
  assert.equal(sent.posts.filter(p => p.action === "add-linkedin").length, 1);
  assert.ok(!new URL(sent.page.url()).searchParams.has("add"), "the add link is not kept in history");
  if (shots) await sent.page.screenshot({ path: `${shots}/link-added-mobile.png` });
  await sent.context.close();
  console.log("LinkedIn link UI verified.");
} finally {
  await browser.close(); server.close();
}
