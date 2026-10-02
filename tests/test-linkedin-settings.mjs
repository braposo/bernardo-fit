import assert from 'node:assert/strict';
import { DEFAULT_LINKEDIN_SETTINGS, validateLinkedInSettings } from '../lib/sanity/linkedin-settings.js';
import { linkedinV2MigrationFields } from '../lib/sanity/linkedin-migration.js';

const v1 = {
  resultsPerSearch: 40, mismatchProbability: 0.9,
  instructions: 'Legacy card triage', investigateCriteria: 'Plausibly relevant',
  mismatchCriteria: 'Clear mismatch', requestMinSeconds: 30, requestMaxSeconds: 60,
  requestTimeoutSeconds: 25, retry: structuredClone(DEFAULT_LINKEDIN_SETTINGS.retry),
};
const doc = {_id:'fit-analysis-settings',_rev:'published-1',linkedinScreening:v1,unrelated:'editorial'};
assert.equal(validateLinkedInSettings(v1).policyVersion, 1);
assert.equal(validateLinkedInSettings(DEFAULT_LINKEDIN_SETTINGS).policyVersion, 2);
assert.equal(validateLinkedInSettings(DEFAULT_LINKEDIN_SETTINGS).enabled, false);
assert.deepEqual(validateLinkedInSettings({...DEFAULT_LINKEDIN_SETTINGS, resultsPerSearch: -1}).searches,
  DEFAULT_LINKEDIN_SETTINGS.searches, 'Retired v1 fields are ignored by v2');
assert.equal(validateLinkedInSettings({...DEFAULT_LINKEDIN_SETTINGS,
  searches:[{keywords:'Engineering Manager',location:'Leeds'}]}).searches[0].location, 'Leeds',
  'Published editorial search locations are allowed');

for (const change of [
  {policyVersion:3}, {enabled:null}, {searchPageSize:0}, {maxSearchPages:41},
  {relevanceProbability:0.4}, {searches:[]},
  {searches:[{keywords:' ',location:'United Kingdom'}]},
  {searches:[{keywords:'Engineering Manager',location:' '}]},
  {searches:Array.from({length:6},()=>({keywords:'Engineering Manager',location:'United Kingdom'}))},
  {searches:[{keywords:'Engineering Manager',location:'United Kingdom',remote:true}]},
  {requestTimeoutSeconds:46}, {instructions:' '},
]) assert.throws(() => validateLinkedInSettings({...DEFAULT_LINKEDIN_SETTINGS,...change}),
  {code:'SANITY_SETTINGS_INVALID'});

const fields = linkedinV2MigrationFields(doc);
assert.equal(fields['linkedinScreening.enabled'], false);
assert.equal(fields['linkedinScreening.searchPageSize'], 40);
assert.deepEqual(fields['linkedinScreening.searches'], DEFAULT_LINKEDIN_SETTINGS.searches);
assert.equal(doc.linkedinScreening.policyVersion, undefined, 'Planning does not mutate published data');
assert.equal(doc.unrelated, 'editorial');
const migrated = structuredClone(v1);
for (const [path,value] of Object.entries(fields)) migrated[path.slice('linkedinScreening.'.length)] = value;
assert.equal(validateLinkedInSettings(migrated).policyVersion, 2);
assert.equal(migrated.requestMinSeconds, 30, 'Legacy fields are preserved for audit');
assert.equal(linkedinV2MigrationFields({...doc,linkedinScreening:migrated}), null, 'Migration is idempotent');
assert.throws(() => linkedinV2MigrationFields({...doc,_rev:null}), /revision/);
assert.throws(() => linkedinV2MigrationFields({...doc,linkedinScreening:null}), /missing/);
console.log('passed 1, failed 0');
