// Dry run by default; pass --apply to write. Moves published settings from
// superseded model IDs to their replacements (lib/models.js RETIRED_MODELS).
// Revision-guarded and idempotent. A document with an open draft is left for
// review so editorial work in progress is never overwritten.
import {pathToFileURL} from 'node:url';
import {createStorageClient} from '../lib/sanity/client.js';
import {RETIRED_MODELS, MODEL_LABELS} from '../lib/models.js';
import {DEFAULT_SETTINGS} from '../lib/sanity/analysis-defaults.js';

const IDS = ['fit-analysis-settings', 'application-cv-settings', 'fit-chat-settings'];
const PREVIOUS_SOL_TEXT = 'Standard fit pages, cover letters, research or interview briefs needing synthesis across several clear sources and ordinary writing constraints.';
const OLD_CHAT_LABELS = {'gpt-5.6-sol': 'Sol', 'claude-opus-5': 'Opus', 'claude-sonnet-5': 'Sonnet'};
const replacement = id => RETIRED_MODELS[id]?.replacement;
const sel = key => `[_key=="${key}"]`;

export function plannedChanges(doc) {
  const set = {};
  if (doc._id === 'fit-analysis-settings') {
    const question = (doc.questions || []).find(q => q.key === 'writingModel');
    for (const option of question?.options || []) {
      const next = replacement(option.key);
      if (!next) continue;
      const path = `questions${sel(question._key)}.options${sel(option._key)}`;
      set[path + '.key'] = next;
      // Only the untouched seed wording is refreshed; edited text is preserved.
      if (option.text === PREVIOUS_SOL_TEXT) set[path + '.text'] = DEFAULT_SETTINGS.questions.writingModel.criteria[next];
    }
  } else if (doc._id === 'application-cv-settings') {
    if (replacement(doc.model)) set.model = replacement(doc.model);
  } else if (doc._id === 'fit-chat-settings') {
    for (const model of doc.models || []) {
      const next = replacement(model.id);
      if (!next) continue;
      set[`models${sel(model._key)}.id`] = next;
      if (model.label === OLD_CHAT_LABELS[model.id]) set[`models${sel(model._key)}.label`] = MODEL_LABELS[next];
    }
  }
  return set;
}

export async function migrateLatestModels({client = createStorageClient(), apply = false} = {}) {
  const raw = client.withConfig({perspective: 'raw'});
  const docs = await raw.fetch('*[_id in $ids || _id in $drafts]{_id,_rev,model,models,questions[]{_key,key,options}}',
    {ids: IDS, drafts: IDS.map(id => 'drafts.' + id)});
  const results = [];
  for (const id of IDS) {
    const doc = docs.find(d => d._id === id);
    if (!doc) { results.push({id, status: 'missing'}); continue; }
    const set = plannedChanges(doc);
    if (!Object.keys(set).length) { results.push({id, status: 'current'}); continue; }
    if (docs.some(d => d._id === 'drafts.' + id)) { results.push({id, status: 'skipped: publish or discard the open draft first', set}); continue; }
    if (!apply) { results.push({id, status: 'needed', set}); continue; }
    await client.patch(id).ifRevisionId(doc._rev).set(set).commit({visibility: 'sync'});
    results.push({id, status: 'applied', set});
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await migrateLatestModels({apply: process.argv.includes('--apply')}), null, 2));
