// HTTP for learned preference rules. Served through /api/admin/jobs to stay
// within the hosting plan's function count. Admin only (x-admin-secret).
//
// GET  ?preferences=1[&state=proposed|accepted|rejected|all] -> { rules, lastLearnedAt }
// POST { action: "accept-preference", id }        -> { rule }
// POST { action: "reject-preference", id }        -> { rule }
// POST { action: "edit-preference", id, text }    -> { rule }  (saves the wording and accepts it)
// POST { action: "delete-preference", id }        -> { deleted: id }
import { listPreferenceRules, decidePreferenceRule } from "../review-preferences.js";

const ACTIONS = { "accept-preference": "accept", "reject-preference": "reject", "edit-preference": "edit", "delete-preference": "delete" };

export async function listPreferencesResponse(query) {
  return listPreferenceRules({ state: typeof query?.state === "string" ? query.state.slice(0, 20) || "all" : "all" });
}

// Returns { status, json }, or null when the action is not one of these.
export async function preferenceAction(body) {
  const action = ACTIONS[body?.action];
  if (!action) return null;
  if (typeof body.id !== "string" || !body.id) return { status: 400, json: { error: "Missing rule id" } };
  return { status: 200, json: await decidePreferenceRule(body.id, action, { text: body.text }) };
}
