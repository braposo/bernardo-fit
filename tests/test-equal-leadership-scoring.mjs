import assert from 'node:assert/strict';
import {plan,RUBRIC,CANDIDATE_SWAPS} from '../scripts/equal-leadership-scoring.mjs';
const q=(key,from)=>({_key:key,key,instructions:`x ${from} y`,criteria:['a','b','c','d','e']});
const settings={_id:'s',_rev:'r',texts:[{_key:'candidateProfile',key:'candidateProfile',text:CANDIDATE_SWAPS[5][0]}],
  questions:[q('responsibilities',RUBRIC.responsibilities.swaps.map(s=>s[0]).join(' ')),q('direction',RUBRIC.direction.swaps[0][0])]};
const patches=plan({settings,candidates:[]});
assert.equal(patches.length,1);
const set=patches[0].set;
assert.ok(set['questions[_key=="responsibilities"].instructions'].includes('Do not prefer one work mix'));
assert.equal(set['questions[_key=="direction"].criteria'][0],'a');
const after={...settings,questions:settings.questions.map(x=>({...x,instructions:set[`questions[_key=="${x.key}"].instructions`],criteria:set[`questions[_key=="${x.key}"].criteria`]})),
  texts:[{...settings.texts[0],text:set['texts[_key=="candidateProfile"].text']}]};
assert.equal(plan({settings:after,candidates:[]}).length,0,'second run plans nothing');
assert.throws(()=>plan({settings:{...settings,questions:[q('responsibilities','other'),q('direction','other')]},candidates:[]}),/review the live rubric/);
console.log('passed 4, failed 0');
