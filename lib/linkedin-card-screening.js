import { createHash } from 'node:crypto';
import { evaluateJev, JEV_MODEL, JEV_POLICY_VERSION } from './jev.js';
import { settingsText, settingsQuestion, linkedinSettings } from './sanity/analysis-settings.js';
import { getTaskInput, saveTaskInput } from './task-results.js';

const questionsFor = config => ({
  relevance: {
    type: 'choice',
    instructions: config.instructions,
    criteria: {
      investigate: config.investigateCriteria,
      mismatch: config.mismatchCriteria,
    },
  },
});

export async function screenLinkedInCard(posting, { evaluate = evaluateJev,
  load = getTaskInput, save = saveTaskInput } = {}) {
  const config = linkedinSettings();
  const questions = questionsFor(config);
  const state = { candidate: settingsText('candidateProfile'),
    constraints: settingsQuestion('constraint'),
    card: Object.fromEntries(['id', 'role', 'company', 'location', 'postedDate'].map(key => [key, String(posting[key] || '')])) };
  const fingerprint = createHash('sha256').update(JSON.stringify({ state, questions,
    model: JEV_MODEL, transport: JEV_POLICY_VERSION, policy: 'linkedin-card-v1', mismatchProbability: config.mismatchProbability })).digest('hex');
  const cached = await load('linkedin-card-screen', fingerprint);
  if (cached) return cached;
  const { answers } = await evaluate({ state, questions, kind: 'linkedin-card-screen', ref: `linkedin-${posting.id}` });
  const answer = answers.relevance;
  const decision = answer.choice === 'mismatch' && answer.probabilities.mismatch >= config.mismatchProbability ? 'skip' : 'fetch';
  return save('linkedin-card-screen', fingerprint, { decision, fingerprint, model: JEV_MODEL, answer });
}
