// Shared with the chat worker; kept in this directory so Sanity Functions packages it.
import { createClient } from '@sanity/client';
import { createHash } from 'node:crypto';

export const CHAT_SETTINGS_ID = 'fit-chat-settings';
export const CHAT_SETTINGS_QUERY = `*[_type == "chatSettings" && _id == "fit-chat-settings"][0]{
  _id, _rev, policy, assistantInstructions, contextInstructions, routingInstructions,
  jevModel, confidenceThreshold, probabilityThreshold, maxOutputTokens, maxSteps,
  models[]{id, provider, label, description, enabled, fallbackPriority},
  classifierModel, gapThreshold, classificationQuestions[]{key, type, instructions, criteria, label, options[]{key,text}}
}`;
const invalid = () => Object.assign(new Error('Publish valid Chat settings in Sanity before trying again.'), {status:503,code:'CHAT_SETTINGS_INVALID'});
const check = condition => { if (!condition) throw invalid(); };
const text = (value, max = 20000) => { check(typeof value === 'string' && !!value.trim() && value.length <= max); return value.trim(); };
const number = (value, min, max, integer = false) => { check(Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value))); return value; };
const modelId = value => { text(value, 150); check(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value)); return value; };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

export function chatSettingsFromDocument(doc) {
  check(doc?._id === CHAT_SETTINGS_ID);
  check(Array.isArray(doc.models) && doc.models.length > 0 && doc.models.length <= 16);
  const models = doc.models.map(m => {
    check(m && typeof m === 'object');
    check(['openai','anthropic'].includes(m.provider) && typeof m.enabled === 'boolean');
    return {id:modelId(m.id),provider:m.provider,label:text(m.label,100),description:text(m.description,4000),
      enabled:m.enabled,fallbackPriority:number(m.fallbackPriority,1,100,true)};
  });
  check(new Set(models.map(m=>m.id)).size === models.length && models.some(m=>m.enabled));
  check(Array.isArray(doc.classificationQuestions) && doc.classificationQuestions.length >= 2 && doc.classificationQuestions.length <= 32);
  const questions = {}, gaps = {};
  for (const q of doc.classificationQuestions) {
    check(q && typeof q.key === 'string' && /^[a-z][a-z0-9_]{0,49}$/.test(q.key) && !Object.hasOwn(questions,q.key) && !['constructor','prototype','__proto__'].includes(q.key));
    const instructions = text(q.instructions);
    if (q.key === 'success') {
      check(q.type === 'score' && Array.isArray(q.criteria) && q.criteria.length === 10);
      questions[q.key] = {type:'score',instructions,criteria:q.criteria.map(c=>text(c,2000))};
    } else if (q.key === 'sentiment') {
      check(q.type === 'choice' && Array.isArray(q.options) && q.options.length === 3 &&
        ['positive','neutral','negative'].every(k=>q.options.filter(o=>o.key===k).length===1));
      questions[q.key] = {type:'choice',instructions,criteria:Object.fromEntries(q.options.map(o=>[o.key,text(o.text,2000)]))};
    } else {
      check(q.type === 'noul'); gaps[q.key] = text(q.label,200);
      questions[q.key] = {type:'noul',instructions};
    }
  }
  check(questions.success && questions.sentiment);
  const settings = {
    policy:text(doc.policy,100),assistantInstructions:text(doc.assistantInstructions),contextInstructions:text(doc.contextInstructions),
    routingInstructions:text(doc.routingInstructions),jevModel:modelId(doc.jevModel),
    confidenceThreshold:number(doc.confidenceThreshold,0,1),probabilityThreshold:number(doc.probabilityThreshold,0,1),
    maxOutputTokens:number(doc.maxOutputTokens,256,16384,true),maxSteps:number(doc.maxSteps,1,10,true),models,
    classifierModel:modelId(doc.classifierModel),gapThreshold:number(doc.gapThreshold,0,1),questions,gaps,
  };
  return freeze({...settings,documentId:CHAT_SETTINGS_ID,revision:doc._rev || 'unpublished-fixture',
    fingerprint:createHash('sha256').update(JSON.stringify(settings)).digest('hex')});
}

export async function loadChatSettings({env=process.env,client,signal} = {}) {
  try {
    if (!client) {
      check(!!env.SANITY_READ_TOKEN?.trim());
      client = createClient({projectId:'quli96gc',dataset:'production',apiVersion:'2026-09-22',
        token:env.SANITY_READ_TOKEN,perspective:'published',useCdn:false,timeout:10000,maxRetries:1});
    }
    const doc = await client.fetch(CHAT_SETTINGS_QUERY, {}, {perspective:'published',signal});
    check(typeof doc?._rev === 'string' && !!doc._rev);
    return chatSettingsFromDocument(doc);
  } catch (error) {
    if (error.code === 'CHAT_SETTINGS_INVALID') throw error;
    throw Object.assign(new Error('Chat settings could not be loaded. Please retry.'), {status:503,code:'CHAT_SETTINGS_UNAVAILABLE'});
  }
}
