// Canonical schema; also installed in the sibling studio-fit-app/schemaTypes directory.
import {defineType, defineField, defineArrayMember} from 'sanity'
import {CogIcon} from '@sanity/icons/Cog'

export const chatSettings = defineType({
  name:'chatSettings', title:'Chat settings', type:'document', icon:CogIcon,
  description:'Publish to apply to new chat requests and Insights classification batches. Running requests keep their original settings.',
  groups:[{name:'prompts',title:'Assistant',default:true},{name:'routing',title:'Models & routing'},{name:'insights',title:'Insights'}],
  fields:[
    defineField({name:'title',type:'string',initialValue:'Chat settings',validation:r=>r.required()}),
    defineField({name:'policy',title:'Policy version',type:'string',group:'prompts',description:'Your version label, recorded alongside the exact document revision.',validation:r=>r.required().max(100)}),
    ...['assistantInstructions','contextInstructions'].map(name=>defineField({name,type:'text',rows:15,group:'prompts',validation:r=>r.required().max(20000)})),
    defineField({name:'maxOutputTokens',title:'Maximum response tokens per step',type:'number',group:'prompts',validation:r=>r.required().integer().min(256).max(16384)}),
    defineField({name:'maxSteps',title:'Maximum agent steps',description:'The last step is reserved for answering. One step disables tool calls.',type:'number',group:'prompts',validation:r=>r.required().integer().min(1).max(10)}),
    defineField({name:'jevModel',title:'Jev routing model',type:'string',group:'routing',validation:r=>r.required().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/).max(150)}),
    defineField({name:'routingInstructions',type:'text',rows:8,group:'routing',validation:r=>r.required().max(20000)}),
    ...['confidenceThreshold','probabilityThreshold'].map(name=>defineField({name,type:'number',group:'routing',description:'Below this threshold, use the available model with the lowest fallback priority.',validation:r=>r.required().min(0).max(1)})),
    defineField({name:'models',type:'array',group:'routing',description:'Use exact API model IDs. Only enabled models with configured credentials are offered to Jev.',
      validation:r=>r.required().min(1).max(16).custom((items:any)=>!items || (new Set(items.map((m:any)=>m.id)).size===items.length && items.some((m:any)=>m.enabled)) || 'Use unique model IDs and enable at least one model.'),
      of:[defineArrayMember({name:'chatModel',type:'object',fields:[
        defineField({name:'id',title:'API model ID',type:'string',validation:r=>r.required().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/).max(150)}),
        defineField({name:'provider',type:'string',options:{list:['openai','anthropic']},validation:r=>r.required().custom(v=>['openai','anthropic'].includes(v||'')||'Choose OpenAI or Anthropic')}),
        defineField({name:'label',type:'string',validation:r=>r.required().max(100)}),
        defineField({name:'enabled',type:'boolean',initialValue:true,validation:r=>r.required()}),
        defineField({name:'description',title:'When Jev should choose this model',type:'text',rows:4,validation:r=>r.required().max(4000)}),
        defineField({name:'fallbackPriority',type:'number',description:'Lower numbers are preferred when routing is uncertain. Ties use list order.',validation:r=>r.required().integer().min(1).max(100)}),
      ],preview:{select:{title:'label',subtitle:'id'}}})]}),
    defineField({name:'classifierModel',title:'Jev classification model',type:'string',group:'insights',validation:r=>r.required().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/).max(150)}),
    defineField({name:'gapThreshold',title:'Content gap probability threshold',type:'number',group:'insights',validation:r=>r.required().min(0).max(1)}),
    defineField({name:'classificationQuestions',type:'array',group:'insights',
      description:'Keep success (ten score labels) and sentiment (positive, neutral, negative). Add or edit content gaps as needed.',
      validation:r=>r.required().min(2).max(32).custom((items:any)=>!items ||
        (new Set(items.map((q:any)=>q.key)).size===items.length && items.some((q:any)=>q.key==='success'&&q.type==='score') && items.some((q:any)=>q.key==='sentiment'&&q.type==='choice') &&
          items.every((q:any)=>['success','sentiment'].includes(q.key)||q.type==='noul')) || 'Use unique keys, success/score, sentiment/choice, and noul for all content gaps.'),
      of:[defineArrayMember({name:'classificationQuestion',type:'object',fields:[
        defineField({name:'key',type:'string',validation:r=>r.required().regex(/^[a-z][a-z0-9_]{0,49}$/).custom(v=>!['constructor','prototype','__proto__'].includes(v||'')||'Reserved key')}),
        defineField({name:'type',type:'string',options:{list:[{title:'Success score',value:'score'},{title:'Sentiment choice',value:'choice'},{title:'Content gap probability',value:'noul'}]},validation:r=>r.required()}),
        defineField({name:'instructions',type:'text',rows:5,validation:r=>r.required().max(20000)}),
        defineField({name:'label',title:'Content gap label',type:'string',hidden:({parent})=>parent?.type!=='noul',validation:r=>r.custom((v,c)=>(c.parent as any)?.type!=='noul'||!!v?.trim()||'Required').max(200)}),
        defineField({name:'criteria',title:'Score labels (lowest to highest)',type:'array',of:[defineArrayMember({type:'string',validation:r=>r.required().max(2000)})],hidden:({parent})=>parent?.type!=='score',validation:r=>r.custom((v,c)=>(c.parent as any)?.type!=='score'||v?.length===10||'Exactly ten labels required')}),
        defineField({name:'options',type:'array',hidden:({parent})=>parent?.type!=='choice',
          validation:r=>r.custom((v:any,c)=>(c.parent as any)?.type!=='choice'||(v?.length===3&&['positive','neutral','negative'].every(k=>v.filter((o:any)=>o.key===k).length===1))||'Use positive, neutral and negative exactly once'),
          of:[defineArrayMember({name:'classificationOption',type:'object',fields:[
            defineField({name:'key',type:'string',options:{list:['positive','neutral','negative']},validation:r=>r.required()}),
            defineField({name:'text',type:'string',validation:r=>r.required().max(2000)}),
          ]})]}),
      ],preview:{select:{title:'key',subtitle:'type'}}})]}),
  ],
  preview:{prepare:()=>({title:'Chat settings',subtitle:'Publish to apply to new requests',media:CogIcon})},
})
