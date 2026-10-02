import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialSettingsDocument } from '../lib/sanity/settings-document.js';
import { managementFitMigrationPlan, applyManagementFitMigration, MANAGEMENT_CANDIDATE_PRIORITIES, PRESERVED_PRACTICAL_GUIDANCE } from '../lib/sanity/management-fit-migration.js';

const settings = () => {
  const doc = { ...initialSettingsDocument(), _rev: 'settings-revision', editorialNote: 'preserve me' };
  doc.texts.find(t => t.key === 'candidateProfile').text += '\n\n' + Object.values(MANAGEMENT_CANDIDATE_PRIORITIES).join('\n\n');
  return doc;
};
const candidate = () => ({ _id: 'candidate-test', _type: 'candidateProfile', _rev: 'candidate-revision',
  migration: { sourceKey: 'candidate:bernardo' }, careerDirection: 'Existing editorial context', workingPreferences: 'UK remote',
  summary: [{ _type: 'block', children: [{ text: 'Evidence remains untouched' }] }] });
const s = settings();
const c = candidate();
const original = structuredClone({ s, c });
const oldWeights = [25, 25, 20, 20, 10];
s.dimensions.forEach((dimension, index) => { dimension.weight = oldWeights[index]; });
const plan = managementFitMigrationPlan(s, c);
assert.equal(plan.length, 2);
assert.deepEqual(Object.values(plan[0].fields), [30, 30, 15, 5, 20]);
assert.equal(plan[0].revision, 'settings-revision');
assert.ok(plan[1].fields.careerDirection.startsWith(c.careerDirection));
assert.ok(plan[1].fields.workingPreferences.startsWith(c.workingPreferences));
assert.deepEqual(c, original.c);
assert.equal(s.editorialNote, 'preserve me');
assert.deepEqual(managementFitMigrationPlan(settings(), { ...c, ...plan[1].fields }), []);
const legacy = JSON.parse(readFileSync(new URL('./fixtures/management-fit-legacy.json', import.meta.url)));
const historical = settings();
const practical = historical.questions.find(q => q.key === 'practical');
const desiredInstructions = practical.instructions;
practical.instructions = legacy.practicalInstructions.slice(0, 2195) + PRESERVED_PRACTICAL_GUIDANCE + legacy.practicalInstructions.slice(2195);
const historicalPlan = managementFitMigrationPlan(historical, { ...c, ...plan[1].fields });
const practicalPath = `questions[_key=="${practical._key}"].instructions`;
assert.equal(historicalPlan[0].fields[practicalPath], `${desiredInstructions}\n\n${PRESERVED_PRACTICAL_GUIDANCE}`);
practical.instructions = historicalPlan[0].fields[practicalPath];
assert.deepEqual(managementFitMigrationPlan(historical, { ...c, ...plan[1].fields }), []);
const editorialProfile = settings();
editorialProfile.texts.find(t => t.key === 'candidateProfile').text = 'Published evidence and editorial additions';
const profilePlan = managementFitMigrationPlan(editorialProfile, c);
assert.ok(profilePlan[0].fields['texts[_key=="candidateProfile"].text'].startsWith('Published evidence and editorial additions\n\n'));
for (const priority of Object.values(MANAGEMENT_CANDIDATE_PRIORITIES))
  assert.doesNotMatch(priority, /mortgage|house|last.*role|business|products/i);

const divergent = settings();
divergent.questions.find(q => q.key === 'direction').instructions = 'An intentional editorial change';
assert.throws(() => managementFitMigrationPlan(divergent, c), /Editorial divergence/);
const weightConflict = settings();
weightConflict.dimensions[0].weight = 42;
assert.throws(() => managementFitMigrationPlan(weightConflict, c), /Editorial divergence/);
const duplicate = settings();
duplicate.dimensions.push({ ...duplicate.dimensions[0] });
assert.throws(() => managementFitMigrationPlan(duplicate, c), /Expected one keyed/);
assert.throws(() => managementFitMigrationPlan({ ...s, _id: 'drafts.fit-analysis-settings' }, c), /Published/);
assert.throws(() => managementFitMigrationPlan(s, { ...c, _id: 'drafts.candidate-test' }), /Published/);

const writes = [];
let committed = 0;
const transaction = {
  patch(id, build) {
    let revision;
    const patch = { ifRevisionId(value) { revision = value; return this; }, set(fields) { writes.push({ id, revision, fields }); return this; } };
    build(patch);
    return this;
  },
  async commit() { committed++; },
};
await applyManagementFitMigration({ transaction: () => transaction }, plan);
assert.deepEqual(writes, plan);
assert.equal(committed, 1);
await applyManagementFitMigration({ transaction() { throw new Error('No-op must not write'); } }, []);
await assert.rejects(applyManagementFitMigration({ transaction: () => ({ ...transaction, async commit() { throw new Error('Revision conflict'); } }) }, plan), /Revision conflict/);
console.log('passed 20, failed 0');
