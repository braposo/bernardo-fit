import { createHash } from 'node:crypto';
import { evaluateJev, JEV_MODEL, JEV_POLICY_VERSION } from './jev.js';
import { settingsText, settingsQuestion, linkedinSettings } from './sanity/analysis-settings.js';
import { getTaskInput, saveTaskInput } from './task-results.js';

const cardFields = ['id', 'role', 'company', 'location', 'postedDate'];
const cardIdentity = posting => Object.fromEntries(cardFields.map(key => [key, String(posting[key] || '')]));

function questionFor(config, posting) {
  return {
    type: 'choice',
    instructions: `${config.instructions}\n\nEvaluate this posting only. Posting id: ${posting.id}. Use its matching entry in state.cards.`,
    criteria: { investigate: config.investigateCriteria, mismatch: config.mismatchCriteria },
  };
}

function decisionFor(answer, config) {
  const probabilities = answer?.probabilities || {};
  if (config.policyVersion === 2) {
    if (answer.choice === 'investigate' && probabilities.investigate >= config.relevanceProbability)
      return { decision: 'fetch', relevanceProbability: probabilities.investigate };
    if (answer.choice === 'mismatch' && probabilities.mismatch >= config.relevanceProbability)
      return { decision: 'skip', relevanceProbability: probabilities.investigate };
    return { decision: 'defer', relevanceProbability: probabilities.investigate };
  }
  return { decision: answer.choice === 'mismatch' && probabilities.mismatch >= config.mismatchProbability ? 'skip' : 'fetch',
    relevanceProbability: probabilities.investigate };
}

export async function screenLinkedInCards(postings, {
  evaluate = evaluateJev, load = getTaskInput, save = saveTaskInput, chunkSize = 8, onChunkComplete,
} = {}) {
  if (!Array.isArray(postings)) throw new TypeError('LinkedIn cards must be an array');
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 20) throw new RangeError('LinkedIn card chunk size must be between 1 and 20');
  const config = linkedinSettings();
  const candidate = settingsText('candidateProfile');
  const constraints = settingsQuestion('constraint');
  const entries = [];
  const seen = new Set();
  for (let index = 0; index < postings.length; index++) {
    const posting = postings[index];
    const postingId = String(posting?.id ?? '');
    if (!postingId || seen.has(postingId)) continue;
    seen.add(postingId);
    const card = cardIdentity(posting);
    const question = questionFor(config, posting);
    const state = { candidate, constraints, card };
    const fingerprint = createHash('sha256').update(JSON.stringify({ state, question,
      model: JEV_MODEL, transport: JEV_POLICY_VERSION,
      policy: { policyVersion: config.policyVersion || 1, instructions: config.instructions,
        investigateCriteria: config.investigateCriteria, mismatchCriteria: config.mismatchCriteria,
        relevanceProbability: config.relevanceProbability, mismatchProbability: config.mismatchProbability } })).digest('hex');
    entries.push({ postingId, card, question, state, fingerprint });
  }

  const results = new Map();
  const uncached = [];
  for (const entry of entries) {
    const cached = await load('linkedin-card-screen', entry.fingerprint);
    if (cached?.fingerprint === entry.fingerprint && ['fetch', 'defer', 'skip'].includes(cached.decision))
      results.set(entry.postingId, cached);
    else uncached.push(entry);
  }

  for (let offset = 0; offset < uncached.length; offset += chunkSize) {
    const chunk = uncached.slice(offset, offset + chunkSize);
    const questions = Object.fromEntries(chunk.map(entry => [`card_${entry.postingId}`, {
      ...entry.question,
      instructions: `${entry.question.instructions}\n\nThe candidate profile and this role's factual details are in state.cards["${entry.postingId}"].`,
    }]));
    const state = { candidate, constraints, cards: Object.fromEntries(chunk.map(entry => [entry.postingId, entry.card])) };
    let answers;
    try {
      ({ answers } = await evaluate({ state, questions, kind: 'linkedin-card-screen-batch',
        ref: `linkedin-cards-${chunk.map(entry => entry.postingId).join('-')}` }));
    } catch (error) {
      if (error.fatal) throw error;
      for (const entry of uncached.slice(offset))
        results.set(entry.postingId, { postingId: entry.postingId, decision: 'defer', fingerprint: entry.fingerprint,
          reason: `Jev batch screening failed: ${error.message}` });
      await onChunkComplete?.({ completed: uncached.length, total: uncached.length, failed: true });
      break;
    }
    let invalidAnswer;
    for (const entry of chunk) {
      const answer = answers?.[`card_${entry.postingId}`];
      if (!answer || !['investigate', 'mismatch'].includes(answer.choice) ||
        !Number.isFinite(answer.probabilities?.investigate) || answer.probabilities.investigate < 0 || answer.probabilities.investigate > 1 ||
        !Number.isFinite(answer.probabilities?.mismatch) || answer.probabilities.mismatch < 0 || answer.probabilities.mismatch > 1 ||
        Math.abs(answer.probabilities.investigate + answer.probabilities.mismatch - 1) > 0.02) {
        invalidAnswer = new Error(`Jev returned no valid LinkedIn relevance answer for posting ${entry.postingId}`);
        break;
      }
      const result = { ...decisionFor(answer, config), postingId: entry.postingId,
        fingerprint: entry.fingerprint, model: JEV_MODEL, answer };
      results.set(entry.postingId, await save('linkedin-card-screen', entry.fingerprint, result));
    }
    if (invalidAnswer) {
      for (const entry of uncached.slice(offset))
        if (!results.has(entry.postingId)) results.set(entry.postingId, { postingId: entry.postingId,
          decision: 'defer', fingerprint: entry.fingerprint, reason: invalidAnswer.message });
      await onChunkComplete?.({ completed: uncached.length, total: uncached.length, failed: true });
      break;
    }
    await onChunkComplete?.({ completed: Math.min(offset + chunk.length, uncached.length), total: uncached.length });
  }
  return entries.map(entry => results.get(entry.postingId));
}

export async function screenLinkedInCard(posting, options = {}) {
  return (await screenLinkedInCards([posting], options))[0];
}
