import assert from 'node:assert/strict';
import {swapText,planHandsOnLeadPositioning} from '../scripts/apply-hands-on-lead-positioning.mjs';

assert.equal(swapText('a old b',[['old','new']],'t'),'a new b');
assert.equal(swapText('a new b',[['old','new']],'t'),'a new b','already applied swaps are skipped');
assert.equal(swapText('nothing here',[['old','new']],'t'),'nothing here');
assert.throws(()=>swapText('old old',[['old','new']],'t'),/expected one match/);
assert.throws(()=>planHandsOnLeadPositioning({drafts:['drafts.x']}),/Publish or discard/);
console.log('hands-on lead positioning: ok');
