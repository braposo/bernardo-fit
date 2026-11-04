import { layoutFlow, flowSvg, withoutScreening, weeklySvg, percent, daysText, activityText, activityGroups, isNewSince } from "../public/pipeline-insights.js";

let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (e !== undefined ? " -> " + JSON.stringify(e) : "")); } };

const flow = {
  columns: ["Discovered", "New", "Reviewing", "Applied", "Interviewing", "Offer"],
  nodes: [
    { id: "discovered", column: 0, label: "Discovered", kind: "source", value: 30 },
    { id: "screened", column: 1, label: "Screened out", kind: "drop", value: 10, breakdown: { screened: 10 } },
    { id: "new", column: 1, label: "New", kind: "stage", value: 20, still: 2 },
    { id: "drop-new", column: 2, label: "Dropped", kind: "drop", value: 8, breakdown: { not_interested: 8 } },
    { id: "reviewing", column: 2, label: "Reviewing", kind: "stage", value: 10, still: 4 },
    { id: "applied", column: 3, label: "Applied", kind: "stage", value: 6, still: 6 },
    { id: "interviewing", column: 4, label: "Interviewing", kind: "stage", value: 0, still: 0 },
    { id: "offer", column: 5, label: "Offer", kind: "stage", value: 0, still: 0 },
  ],
  links: [
    { source: "discovered", target: "new", value: 20 }, { source: "discovered", target: "screened", value: 10 },
    { source: "new", target: "reviewing", value: 10 }, { source: "new", target: "drop-new", value: 8 },
    { source: "reviewing", target: "applied", value: 6 },
  ],
};

console.log("\n--- flow layout ---");
const layout = layoutFlow(flow, { width: 960, height: 340 });
const node = id => layout.nodes.find(n => n.id === id);
check("nodes fit the chart height", layout.nodes.every(n => n.y >= 0 && n.y + n.h <= 340.01), layout.nodes.map(n => [n.id, n.y, n.h]));
check("drop-offs sit below the continuing stage", node("drop-new").y > node("reviewing").y + node("reviewing").h);
check("columns move left to right", node("new").x < node("reviewing").x && node("reviewing").x < node("applied").x);
check("node height is proportional", Math.abs(node("new").h / node("reviewing").h - 2) < 1e-6);
check("continuing link leaves from the top of the node", layout.links.find(l => l.target === "reviewing").path.startsWith("M" + (node("new").x + node("new").w) + "," + node("new").y));
check("links are classified", layout.links.find(l => l.target === "screened").kind === "screened" && layout.links.find(l => l.target === "drop-new").kind === "drop");
check("open roles get a stub", layout.stubs.some(s => s.id === "reviewing" && s.still === 4));
check("link share is of the source", Math.abs(layout.links.find(l => l.target === "reviewing").share - 0.5) < 1e-9);
const svg = flowSvg(flow);
check("svg has an accessible summary", /role="img" aria-label="Pipeline flow: New 20, Screened out 10, Reviewing 10, Dropped 8/.test(svg));
check("tooltips name the move and share", svg.includes('data-tip="New → Reviewing: 10 roles (50%)"'));
check("labels are escaped", flowSvg({ ...flow, nodes: flow.nodes.map(n => n.id === "new" ? { ...n, label: "<b>" } : n) }).includes("&lt;b&gt;"));

console.log("\n--- without screening ---");
const trimmed = withoutScreening(flow);
check("starts at New", trimmed.columns[0] === "New" && trimmed.nodes.every(n => n.id !== "discovered" && n.id !== "screened"));
check("columns shift left", trimmed.nodes.find(n => n.id === "new").column === 0);
check("links from discovered are removed", trimmed.links.every(l => l.source !== "discovered"));
check("an empty flow still lays out", layoutFlow({ columns: ["New"], nodes: [{ id: "new", column: 0, label: "New", kind: "stage", value: 0 }], links: [] }).nodes[0].h === 0);

console.log("\n--- formatting ---");
check("percent", percent(0.5) === "50%" && percent(0.004) === "<1%" && percent(null) === "—");
check("days", daysText(0.4) === "<1 day" && daysText(1) === "1 day" && daysText(3.46) === "3.5 days" && daysText(12.6) === "13 days" && daysText(null) === "—");
check("weekly chart labels its totals", /aria-label="Weekly intake over 4 weeks: 5 added, 2 applied"/.test(weeklySvg([
  { weekStart: "2026-10-12", added: 2, applied: 1, screened: 0 }, { weekStart: "2026-10-19", added: 3, applied: 1, screened: 4 },
  { weekStart: "2026-10-26", added: 0, applied: 0, screened: 0 }, { weekStart: "2026-11-02", added: 0, applied: 0, screened: 0 }])));
const dailySvg = weeklySvg([{ weekStart: "2026-11-03", added: 1, applied: 0, screened: 0 }, { weekStart: "2026-11-04", added: 2, applied: 1, screened: 0 }], { days: 1 });
check("daily chart labels its totals", /aria-label="Daily intake over 2 days: 3 added, 1 applied"/.test(dailySvg));
check("daily bars are not called weeks", !/Week of/.test(dailySvg));

console.log("\n--- activity ---");
check("stage change text", activityText({ kind: "stage", from: "reviewing", to: "not_interested" }) === "Moved from Reviewing to Not interested");
check("agent move text", activityText({ kind: "stage", from: "new", to: "reviewing", byAgent: true }).startsWith("Moved by agent"));
check("added text names the source", activityText({ kind: "added", source: "LinkedIn" }) === "Added to the pipeline from LinkedIn");
const now = new Date(2026, 10, 4, 12);
const groups = activityGroups([{ at: new Date(2026, 10, 4, 9).toISOString() }, { at: new Date(2026, 10, 4, 1).toISOString() }, { at: new Date(2026, 10, 3, 20).toISOString() }, { at: new Date(2026, 9, 30).toISOString() }], now);
check("groups by day", groups.length === 3 && groups[0].label === "Today" && groups[0].items.length === 2 && groups[1].label === "Yesterday");
check("new since last visit", isNewSince({ at: "2026-11-04T10:00:00Z" }, "2026-11-03T10:00:00Z") && !isNewSince({ at: "2026-11-02T10:00:00Z" }, "2026-11-03T10:00:00Z"));
check("nothing is new on a first visit", !isNewSince({ at: "2026-11-04T10:00:00Z" }, null));

console.log("\npassed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
