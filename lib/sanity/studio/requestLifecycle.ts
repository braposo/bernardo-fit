import {defineField} from 'sanity'
const retryFields = [
  defineField({name:'maxAttempts',type:'number',title:'Total attempts',validation:r=>r.required().integer().min(1).max(5)}),
  defineField({name:'minTimeoutInMs',type:'number',title:'Minimum retry delay (ms)',validation:r=>r.required().integer().min(100).max(3600000)}),
  defineField({name:'maxTimeoutInMs',type:'number',title:'Maximum retry delay (ms)',validation:r=>r.required().integer().min(100).max(3600000).custom((v,c)=>v===undefined || v >= (c.parent as {minTimeoutInMs:number}).minTimeoutInMs || 'Must be at least the minimum delay')}),
  defineField({name:'factor',type:'number',title:'Backoff multiplier',validation:r=>r.required().min(1).max(5)}),
  defineField({name:'randomize',type:'boolean',title:'Randomize backoff',validation:r=>r.required()}),
]
export const requestLifecycle=defineField({
  name:'requestLifecycle',title:'Request lifecycle',type:'object',group:'requests',
  description:'Trigger owns retries and timeouts. Publish to apply to new tasks; running tasks retain their snapshot. One total attempt disables retries.',
  validation:r=>r.required(),
  fields:['jev','openai','anthropic','storage'].map(name=>defineField({
    name,title:name==='storage'?'Conversation persistence':name==='jev'?'Jev':name==='openai'?'OpenAI':'Anthropic',type:'object',validation:r=>r.required(),
    fields:[
      defineField({name:'timeoutSeconds',type:'number',title:name==='storage'?'Task compute limit (seconds)':'HTTP response timeout (seconds)',validation:r=>r.required().integer().min(name==='storage'?5:1).max(240)}),
      defineField({name:'retry',type:'object',title:'Native Trigger retry policy',fields:retryFields,validation:r=>r.required()}),
    ],
  })),
})
