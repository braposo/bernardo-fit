import assert from 'node:assert/strict';
import {withoutClosing,removeFitReportClosing} from '../scripts/remove-fit-report-closing.mjs';
import {DEFAULT_SETTINGS} from '../lib/sanity/analysis-defaults.js';

const published='## Output\n{\n  "pitch": "p",\n  "differentiators": [{"headline": "h", "detail": "d"}],\n  "closing": "At most 20 words inviting a conversation, without repeating the pitch"\n}\nThe categories array must contain exactly three items.';
const cleaned=withoutClosing(published);
assert.equal(cleaned,'## Output\n{\n  "pitch": "p",\n  "differentiators": [{"headline": "h", "detail": "d"}]\n}\nThe categories array must contain exactly three items.');
assert.equal(withoutClosing(cleaned),cleaned);
assert.equal(withoutClosing(DEFAULT_SETTINGS.texts.analysis),DEFAULT_SETTINGS.texts.analysis);
assert.throws(()=>withoutClosing('Write a "closing": "x" somewhere else'),/unexpected shape/);

const fake=(docs,log=[])=>({withConfig:()=>({fetch:async()=>docs}),
  transaction:()=>({patch(id,fn){fn({ifRevisionId(rev){log.push({id,rev});return{set(fields){log.push(fields);return this;}};}});return this;},commit:async()=>log.push('commit')})});
const doc={_id:'fit-analysis-settings',_rev:'r1',analysis:[{_key:'analysis',text:published}]};
assert.deepEqual(await removeFitReportClosing({client:fake([doc])}),{needed:true,applied:false});
const log=[];
assert.deepEqual(await removeFitReportClosing({client:fake([doc],log),apply:true}),{needed:false,applied:true});
assert.deepEqual(log,[{id:'fit-analysis-settings',rev:'r1'},{'texts[_key=="analysis"].text':cleaned},'commit']);
await assert.rejects(removeFitReportClosing({client:fake([doc,{_id:'drafts.fit-analysis-settings'}])}),/draft/);
console.log('remove fit report closing: ok');
