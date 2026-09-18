export function summariseUsage({ days = [], breakdown = [] } = {}) {
  const total = (rows, field) => rows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0);
  const groups = new Map();
  for (const row of breakdown) {
    const key = JSON.stringify([row.kind, row.model, row.effort, row.source]);
    if (!groups.has(key)) groups.set(key, { kind: row.kind, model: row.model, effort: row.effort,
      source: row.source, calls: 0, savedCalls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
      errors: 0, pricedCalls: 0, estimatedCostMicros: 0 });
    const group = groups.get(key);
    for (const field of ["calls", "savedCalls", "input", "output", "cacheRead", "cacheWrite", "errors", "pricedCalls", "estimatedCostMicros"]) {
      group[field] += Number(row[field]) || 0;
    }
  }
  const input = total(days, "input") + total(days, "cacheRead") + total(days, "cacheWrite");
  return { calls: total(days, "calls"), pricedCalls: total(days, "pricedCalls"),
    savedCalls: total(breakdown, "savedCalls"), estimatedUsd: total(days, "estimatedCostMicros") / 1e6,
    input, output: total(days, "output"), cachePercent: input ? total(days, "cacheRead") / input * 100 : 0,
    groups: [...groups.values()].sort((a, b) => b.estimatedCostMicros - a.estimatedCostMicros) };
}
