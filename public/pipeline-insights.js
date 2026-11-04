// Pipeline insights view: pure layout and markup helpers. The browser imports this
// file directly (like pipeline-board.js) and tests/test-pipeline-insights.mjs
// covers it. Data comes from GET /api/admin/jobs?overview=1 (lib/pipeline-overview.js).
//
// Colour encodes one thing in the flow: roles that continue (accent) versus roles
// that leave (drop). Every node is labelled, and the stage table repeats the data.
// The palette was checked with the dataviz validator (accent/drop/applied pass).
export const FLOW_COLORS = { continue: "#6055a6", drop: "#ae4554", screened: "#8a90a0" };
export const WEEK_COLORS = { added: "#6055a6", applied: "#c46a1e" };
export const RANGES = ["7", "14", "30", "90"];
export const RANGE_LABELS = { "7": "1 week", "14": "2 weeks", "30": "30 days", "90": "3 months" };
// "in the last …" wording for the dashboard's subtitles.
export const RANGE_SPANS = { "7": "week", "14": "2 weeks", "30": "30 days", "90": "3 months" };
const STAGE_NAMES = { new: "New", reviewing: "Reviewing", applied: "Applied", interviewing: "Interviewing", offer: "Offer",
  rejected: "Rejected", not_interested: "Not interested", expired: "Expired", archived: "Archived" };

const escape = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export const stageName = stage => STAGE_NAMES[stage] || String(stage || "").replace(/_/g, " ");
const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");
export function percent(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  const p = value * 100;
  return (p > 0 && p < 1 ? "<1" : String(Math.round(p))) + "%";
}
export function daysText(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value < 1) return "<1 day";
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return rounded + (rounded === 1 ? " day" : " days");
}

// ---------- Flow layout ----------

// Positions nodes in columns (continuing stages at the top, drop-offs at the
// bottom) and stacks each node's links so ribbons never cross inside a node.
export function layoutFlow(flow, { width = 960, height = 340, nodeWidth = 12, gap = 22, labelRoom = 120 } = {}) {
  const columns = flow.columns.length;
  const top = 8, bottom = height - 8, usable = bottom - top;
  const x = c => columns < 2 ? 0 : c * (width - labelRoom - nodeWidth) / (columns - 1);
  const byColumn = Array.from({ length: columns }, () => []);
  flow.nodes.forEach(node => byColumn[node.column] && byColumn[node.column].push(node));
  const total = list => list.reduce((sum, n) => sum + n.value, 0);
  const scale = Math.min(...byColumn.filter(list => list.length).map(list => {
    const value = total(list);
    return value ? (usable - gap * (list.length - 1)) / value : Infinity;
  }));
  const k = Number.isFinite(scale) ? scale : 0;
  const nodes = new Map();
  byColumn.forEach(list => {
    const stage = list.filter(n => n.kind !== "drop"), drops = list.filter(n => n.kind === "drop");
    let y = top;
    stage.forEach(n => { const h = n.value * k; nodes.set(n.id, { ...n, x: x(n.column), y, h, w: nodeWidth, out: 0, in: 0 }); y += h + gap; });
    let yb = bottom;
    drops.slice().reverse().forEach(n => { const h = n.value * k; yb -= h; nodes.set(n.id, { ...n, x: x(n.column), y: yb, h, w: nodeWidth, out: 0, in: 0 }); yb -= gap; });
  });
  // Continuing links leave from the top of a node, drop-offs below them.
  const ordered = flow.links.slice().sort((a, b) => (nodes.get(a.target).kind === "drop") - (nodes.get(b.target).kind === "drop"));
  const links = ordered.map(link => {
    const s = nodes.get(link.source), t = nodes.get(link.target), h = link.value * k;
    const y0 = s.y + s.out, y1 = t.y + t.in;
    s.out += h; t.in += h;
    const x0 = s.x + s.w, x1 = t.x, mid = (x0 + x1) / 2;
    const path = `M${r(x0)},${r(y0)}C${r(mid)},${r(y0)} ${r(mid)},${r(y1)} ${r(x1)},${r(y1)}` +
      `L${r(x1)},${r(y1 + h)}C${r(mid)},${r(y1 + h)} ${r(mid)},${r(y0 + h)} ${r(x0)},${r(y0 + h)}Z`;
    return { ...link, h, path, kind: t.kind === "drop" ? (t.id === "screened" ? "screened" : "drop") : "continue",
      share: s.value ? link.value / s.value : null, sourceLabel: s.label, targetLabel: t.label };
  });
  // Roles still open at a stage: a short fading stub after the node's outflow.
  const stubs = [...nodes.values()].filter(n => n.kind === "stage" && n.still > 0 && n.h > 0).map(n => ({
    id: n.id, x: n.x + n.w, y: n.y + n.out, h: n.still * k, still: n.still, label: n.label,
  }));
  return { width, height, nodes: [...nodes.values()], links, stubs, columnX: Array.from({ length: columns }, (_, c) => x(c)) };
}
const r = n => Math.round(n * 10) / 10;

function dropTip(node) {
  const parts = Object.entries(node.breakdown || {}).filter(([kind]) => kind !== "screened").map(([kind, n]) => stageName(kind) + " " + n);
  return parts.join(" · ");
}

export function flowSvg(flow, options = {}) {
  const layout = layoutFlow(flow, options);
  const title = "Pipeline flow: " + layout.nodes.filter(n => n.kind !== "source").map(n => n.label + " " + n.value).join(", ");
  const links = layout.links.map(l => {
    const tip = l.sourceLabel + " → " + l.targetLabel + ": " + plural(l.value, "role") + (l.share != null ? " (" + percent(l.share) + ")" : "");
    return '<path class="flow-link flow-' + l.kind + '" d="' + l.path + '" fill="' + FLOW_COLORS[l.kind] + '" data-tip="' + escape(tip) + '"></path>';
  }).join("");
  const stubs = layout.stubs.map(s => '<rect class="flow-open" x="' + r(s.x) + '" y="' + r(s.y) + '" width="36" height="' + r(Math.max(1, s.h)) +
    '" fill="url(#flow-open-fade)" data-tip="' + escape(s.label + ": " + plural(s.still, "role") + " still here") + '"></rect>').join("");
  const nodes = layout.nodes.map(n => {
    const color = n.kind === "drop" ? (n.id === "screened" ? FLOW_COLORS.screened : FLOW_COLORS.drop) : FLOW_COLORS.continue;
    const tip = n.label + ": " + plural(n.value, "role") + (n.kind === "drop" && dropTip(n) ? " (" + dropTip(n) + ")" : "") +
      (n.still ? " · " + n.still + " still here" : "");
    const rect = '<rect class="flow-node" x="' + r(n.x) + '" y="' + r(n.y) + '" width="' + n.w + '" height="' + r(Math.max(n.value ? 2 : 0, n.h)) +
      '" rx="2" fill="' + color + '" data-tip="' + escape(tip) + '"></rect>';
    // Labels sit right of the node, in the room reserved after the last column.
    const lx = n.x + n.w + 6;
    const ly = Math.min(Math.max(n.y + n.h / 2, 14), layout.height - 14);
    const text = n.label + " " + n.value;
    const width = Math.round(text.length * 6.6 + 16);
    const bx = lx;
    return rect + '<g class="flow-label" aria-hidden="true"><rect x="' + r(bx) + '" y="' + r(ly - 11) + '" width="' + width + '" height="22" rx="6"></rect>' +
      '<text x="' + r(bx + 8) + '" y="' + r(ly + 4) + '"><tspan class="flow-label-name">' + escape(n.label) + '</tspan> <tspan class="flow-label-value">' + n.value + '</tspan></text></g>';
  }).join("");
  return '<svg class="flow-chart" viewBox="0 0 ' + layout.width + ' ' + layout.height + '" role="img" aria-label="' + escape(title) + '">' +
    '<defs><linearGradient id="flow-open-fade"><stop offset="0" stop-color="' + FLOW_COLORS.continue + '" stop-opacity=".35"></stop><stop offset="1" stop-color="' + FLOW_COLORS.continue + '" stop-opacity="0"></stop></linearGradient></defs>' +
    '<g class="flow-links">' + links + stubs + '</g><g class="flow-nodes">' + nodes + '</g></svg>';
}

// The flow without the screening step: it starts at New, so later stages get
// more of the height. Screening is often much larger than everything after it.
export function withoutScreening(flow) {
  const columns = flow.columns.slice(1);
  const nodes = flow.nodes.filter(n => n.id !== "discovered" && n.id !== "screened").map(n => ({ ...n, column: n.column - 1 }));
  const links = flow.links.filter(l => l.source !== "discovered");
  return { columns, nodes, links };
}

// Column headings above the chart, aligned with the node positions.
export function flowColumnsHtml(flow, options = {}) {
  const layout = layoutFlow(flow, options);
  return '<div class="flow-columns" aria-hidden="true">' + flow.columns.map((name, c) =>
    '<span style="left:' + r(layout.columnX[c] / layout.width * 100) + '%">' + escape(name) + '</span>').join("") + '</div>';
}

// ---------- Weekly intake ----------

// One bar pair per bucket: a day when `days` is 1, otherwise a week.
export function weeklySvg(weekly, { width = 520, height = 150, days = 7 } = {}) {
  const daily = days === 1;
  const max = Math.max(1, ...weekly.map(w => Math.max(w.added, w.applied)));
  const axis = 18, plotH = height - axis - 6, slot = width / Math.max(1, weekly.length);
  const bar = Math.max(3, Math.min(14, (slot - 6) / 2 - 1));
  const y = v => 6 + plotH - v / max * plotH;
  const bars = weekly.map((w, i) => {
    const x0 = i * slot + (slot - bar * 2 - 2) / 2;
    const label = new Date(w.weekStart + "T00:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
    const tip = (daily ? label : "Week of " + label) + ": " + plural(w.added, "role") + " added, " + w.applied + " applied" + (w.screened ? ", " + w.screened + " screened out" : "");
    const col = (x, v, color) => v ? '<path d="' + roundedTop(x, y(v), bar, 6 + plotH) + '" fill="' + color + '"></path>' : "";
    const tick = i % Math.ceil(weekly.length / 7) === 0 || i === weekly.length - 1
      ? '<text class="week-tick" x="' + r(i * slot + slot / 2) + '" y="' + (height - 4) + '" text-anchor="middle">' + escape(label) + '</text>' : "";
    return '<g class="week" data-tip="' + escape(tip) + '"><rect class="week-hit" x="' + r(i * slot) + '" y="0" width="' + r(slot) + '" height="' + (6 + plotH) + '"></rect>' +
      col(x0, w.added, WEEK_COLORS.added) + col(x0 + bar + 2, w.applied, WEEK_COLORS.applied) + '</g>' + tick;
  }).join("");
  const total = weekly.reduce((s, w) => s + w.added, 0), applied = weekly.reduce((s, w) => s + w.applied, 0);
  return '<svg class="week-chart" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' +
    escape((daily ? "Daily intake over " + plural(weekly.length, "day") : "Weekly intake over " + plural(weekly.length, "week")) + ": " + total + " added, " + applied + " applied") + '">' +
    '<line class="week-base" x1="0" x2="' + width + '" y1="' + (6 + plotH) + '" y2="' + (6 + plotH) + '"></line>' +
    '<text class="week-max" x="0" y="10">' + max + '</text>' + bars + '</svg>';
}
function roundedTop(x, top, w, base) {
  const rad = Math.min(4, w / 2, base - top);
  return `M${r(x)},${r(base)}V${r(top + rad)}Q${r(x)},${r(top)} ${r(x + rad)},${r(top)}H${r(x + w - rad)}Q${r(x + w)},${r(top)} ${r(x + w)},${r(top + rad)}V${r(base)}Z`;
}

// ---------- Recent activity ----------

export function activityText(item) {
  if (item.kind === "added") return "Added to the pipeline" + (item.source && item.source !== "Other" ? " from " + item.source : "");
  if (item.kind === "interview") return "Interview added" + (item.detail ? " · " + item.detail : "");
  if (item.kind === "stage") return (item.byAgent ? "Moved by agent" : "Moved") + " from " + stageName(item.from) + " to " + stageName(item.to);
  return "Updated";
}

// Groups newest-first items under Today, Yesterday or their date.
export function activityGroups(items, now = new Date()) {
  const day = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = day(now);
  const groups = [];
  for (const item of items) {
    const at = new Date(item.at), diff = Math.round((today - day(at)) / 86400000);
    const label = diff === 0 ? "Today" : diff === 1 ? "Yesterday" : at.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item); else groups.push({ label, items: [item] });
  }
  return groups;
}

// Items after the last visit are new. With no previous visit nothing is marked.
export function isNewSince(item, seenAt) {
  const seen = Date.parse(seenAt);
  return Number.isFinite(seen) && Date.parse(item.at) > seen;
}
