import { createHash } from 'node:crypto';
import { DEFAULT_SETTINGS } from './analysis-defaults.js';

// Baseline hashes from the published-settings seed before the management-priority change.
// An unexpected editorial edit must be reviewed, never overwritten automatically.
const baseline = {
  responsibilities: ['7ec32af09c80f0d331c87d58540216c0e7a859245569409a55a55ec22eaa22fa', '8a5354193b5909f4cac2fc05996212853a04da622c43a4e4976a00b8fcebc8b6'],
  evidence: ['1bd7eda45d688712822418d560c8d9b1232ae6aced1601fb1b38b8e12bf810e5', '2ae9a6dcbe49a635b7f450a04c4afc415769c678696be973abc3c1b44e45bc55'],
  scope: ['642bb0cfc699e3c5bb3724792477e8b360795289767161cfe96226c14ba16bce', '4c7d87ce3e1bd6e09ff953218637c02864bf2ce6e4c0f6220f1446c83be494ed'],
  direction: ['59d4c13b5b615bc774f8e1b569238c916d78f37dbc1df53a97cfac92cc9fb118', 'f2dafb408b12b48a4bc1d0d0ba5c4807ee5013c5d8f5bf8f93aeb5e66a68c7c8'],
  practical: ['4e4f67b15c4d967e26506f26d5ce508b0797541e4fd60c4dee38ea71cab2d485', '8e550cff465f46c6d65b1aa81d6b76b902d7ab180d58cde9af767ea53dfaa64a'],
};
const oldWeights = { responsibilities: 25, evidence: 25, scope: 20, direction: 20, practical: 10 };
const digest = value => createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const PRESERVED_PRACTICAL_GUIDANCE = "Give the employer's explicit location and attendance requirements in the saved job description priority over a broad imported location label. A London office address alone does not prove mandatory attendance. If sources disagree about remote, hybrid or frequency, flag the ambiguity and do not assume the most favourable arrangement. Around one London day weekly is workable; regular two-to-three-day London attendance is a material travel trade-off, distinct from occasional longer visits. Unknown relocation, sponsorship or frequency is uncertainty, not a confirmed agreement or hard conflict. ";
export const MANAGEMENT_CANDIDATE_PRIORITIES = {
  careerDirection: 'Current preference (supersedes earlier career-direction preferences): engineering management using existing experience, with a sustainable, clearly bounded remit. Promotion, a larger title and increasing organisational responsibility are not priorities; an IC pivot is not the preferred route.',
  workingPreferences: 'Current preference (supersedes conflicting earlier working preferences): well-paid, sustainable engineering management with manageable accountability, clear expectations, adequate support and limited firefighting. Assess actual working hours, on-call duties, travel and ability to switch off; do not infer low pressure from a title or familiar work.',
};

export function managementFitMigrationPlan(settings, candidate) {
  if (settings?._id !== 'fit-analysis-settings' || !settings._rev)
    throw new Error('Published Analysis settings and revision are required.');
  if (candidate?._type !== 'candidateProfile' || !candidate._id || candidate._id.startsWith('drafts.') || candidate._id.startsWith('versions.') || !candidate._rev || candidate.migration?.sourceKey !== 'candidate:bernardo')
    throw new Error('Published Bernardo candidate profile and revision are required.');
  const fields = {};
  const locate = (array, key, value) => {
    const matches = Array.isArray(array) ? array.filter(item => item[key] === value) : [];
    if (matches.length !== 1 || typeof matches[0]._key !== 'string' || !/^[\w-]+$/.test(matches[0]._key))
      throw new Error(`Expected one keyed ${key}: ${value}.`);
    return matches[0];
  };
  const guardedSet = (path, current, desired, previousHash) => {
    if (equal(current, desired)) return;
    if (digest(current) !== previousHash) throw new Error(`Editorial divergence at ${path}; review before migrating.`);
    fields[path] = structuredClone(desired);
  };
  for (const dimension of DEFAULT_SETTINGS.dimensions) {
    const { id } = dimension;
    const currentDimension = locate(settings.dimensions, 'id', id);
    guardedSet(`dimensions[_key=="${currentDimension._key}"].weight`, currentDimension.weight, dimension.weight, digest(oldWeights[id]));
    const question = locate(settings.questions, 'key', id);
    for (const [index, field] of ['instructions', 'criteria'].entries()) {
      const path = `questions[_key=="${question._key}"].${field}`;
      const desired = DEFAULT_SETTINGS.questions[id][field];
      if (id === 'practical' && field === 'instructions' && question[field]?.includes(PRESERVED_PRACTICAL_GUIDANCE)) {
        const preserved = `${desired}\n\n${PRESERVED_PRACTICAL_GUIDANCE}`;
        if (!equal(question[field], preserved)) {
          if (digest(question[field].replace(PRESERVED_PRACTICAL_GUIDANCE, '')) !== baseline[id][index])
            throw new Error(`Editorial divergence at ${path}; review before migrating.`);
          fields[path] = preserved;
        }
      } else guardedSet(path, question[field], desired, baseline[id][index]);
    }
  }
  const profile = locate(settings.texts, 'key', 'candidateProfile');
  if (typeof profile.text !== 'string' || !profile.text.trim()) throw new Error('Candidate profile text is required.');
  // The published profile is assembled from editorial evidence, not the code seed.
  // Preserve it in full and make the current preferences explicit without private context.
  let profileText = profile.text;
  for (const priority of Object.values(MANAGEMENT_CANDIDATE_PRIORITIES))
    if (!profileText.includes(priority)) profileText += `\n\n${priority}`;
  if (profileText !== profile.text) fields[`texts[_key=="${profile._key}"].text`] = profileText;
  const candidateFields = {};
  for (const [field, priority] of Object.entries(MANAGEMENT_CANDIDATE_PRIORITIES)) {
    const current = candidate[field];
    if (current != null && typeof current !== 'string') throw new Error(`Invalid candidate ${field}.`);
    if (!current?.includes(priority)) candidateFields[field] = [current, priority].filter(Boolean).join('\n\n');
  }
  return [{ id: settings._id, revision: settings._rev, fields }, { id: candidate._id, revision: candidate._rev, fields: candidateFields }]
    .filter(change => Object.keys(change.fields).length);
}

export async function applyManagementFitMigration(client, plan) {
  if (!plan.length) return;
  let transaction = client.transaction();
  for (const { id, revision, fields } of plan)
    transaction = transaction.patch(id, patch => patch.ifRevisionId(revision).set(fields));
  await transaction.commit();
}
