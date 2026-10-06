import {defineArrayMember,defineField,defineType} from 'sanity'
import {DocumentTextIcon} from '@sanity/icons/DocumentText'
import {CogIcon} from '@sanity/icons/Cog'

const required=(name:string,title:string,type:'string'|'text'='string')=>defineField({name,title,type,validation:rule=>rule.required()})
const publicFlag=defineField({name:'approvedPublic',title:'Approved for public CV generation',type:'boolean',initialValue:false,validation:rule=>rule.required()})
const sourceKey=defineField({name:'seedKey',title:'Seed identity',type:'string',readOnly:true,description:'Used only to make the initial import idempotent.'})
const order=defineField({name:'order',title:'Display order',type:'number',validation:rule=>rule.required().integer().min(0)})

export const applicationCvRole=defineType({name:'applicationCvRole',title:'CV employment',type:'document',icon:DocumentTextIcon,
  fields:[sourceKey,required('title','Role title'),required('company','Company'),required('dates','Dates'),defineField({name:'location',type:'string'}),
    defineField({name:'overviewEvidence',title:'Broad role overview evidence',type:'reference',to:[{type:'applicationCvEvidence'}],
      description:'Approved delivered fact that anchors the rounded scope of this role. The CV may rewrite and reorder it, while retaining its substantive breadth.',
      options:{filter:({document})=>({filter:'role._ref == $roleId && approvedPublic == true && status == "delivered"',
        params:{roleId:String(document?._id||'').replace(/^drafts\./,'')}})},
      validation:rule=>rule.required()}),order,publicFlag],
  preview:{select:{title:'title',subtitle:'company'}}})
export const applicationCvEducation=defineType({name:'applicationCvEducation',title:'CV education',type:'document',icon:DocumentTextIcon,
  fields:[sourceKey,required('title','Qualification'),defineField({name:'dates',type:'string'}),defineField({name:'location',type:'string'}),order,publicFlag]})
export const applicationCvProject=defineType({name:'applicationCvProject',title:'CV contribution',type:'document',icon:DocumentTextIcon,
  fields:[sourceKey,required('title','Contribution'),defineField({name:'dates',type:'string'}),defineField({name:'location',type:'string'}),
    defineField({name:'links',title:'Public links',type:'array',of:[defineArrayMember({type:'object',fields:[required('label','Label'),
      defineField({name:'href',title:'URL',type:'url',validation:rule=>rule.required().uri({scheme:['https','http']})})]})]}),order,publicFlag]})
export const applicationCvEvidence=defineType({name:'applicationCvEvidence',title:'CV evidence',type:'document',icon:DocumentTextIcon,
  fields:[sourceKey,required('text','CV-ready fact','text'),defineField({name:'source',title:'Original source document',type:'reference',to:[{type:'sitePage'},{type:'candidateEvidence'},{type:'candidateProfile'}],validation:rule=>rule.required()}),
    required('sourcePassage','Exact source passage','text'),
    defineField({name:'role',type:'reference',to:[{type:'applicationCvRole'}]}),
    defineField({name:'education',type:'reference',to:[{type:'applicationCvEducation'}]}),
    defineField({name:'project',type:'reference',to:[{type:'applicationCvProject'}]}),
    defineField({name:'contribution',type:'string',options:{list:['personal','team','strategy','mixed'],layout:'radio'},validation:rule=>rule.required()}),
    defineField({name:'status',type:'string',options:{list:['delivered','proposed'],layout:'radio'},validation:rule=>rule.required()}),
    defineField({name:'skills',type:'array',of:[defineArrayMember({type:'string'})]}),order,publicFlag],
  preview:{select:{title:'text',subtitle:'status'}}})
export const applicationCvSettings=defineType({name:'applicationCvSettings',title:'Application CV settings',type:'document',icon:CogIcon,
  fields:[required('model','Generation model'),required('prompt','Generation instructions','text'),required('verifierPrompt','Factual verifier instructions','text'),
    defineField({name:'maxWords',type:'number',validation:rule=>rule.required().integer().min(150).max(1000)}),
    defineField({name:'minBodyPx',title:'Minimum PDF body size (px)',type:'number',validation:rule=>rule.required().min(13).max(18)}),
    defineField({name:'layout',type:'string',options:{list:['classic']},validation:rule=>rule.required()})]})

export const applicationCvJson=defineType({name:'applicationCvJson',title:'Stored application CV data',type:'object',
  fields:[defineField({name:'payload',type:'text'})]})

export const applicationCvBinding=defineType({name:'applicationCvBinding',title:'Application CV binding',type:'document',icon:DocumentTextIcon,readOnly:true,
  fields:[defineField({name:'job',type:'reference',to:[{type:'job'}],validation:rule=>rule.required()}),required('jobId','Legacy job ID'),required('publicId','Public link ID'),
    defineField({name:'versionSequence',title:'Immutable version sequence',type:'number'}),
    defineField({name:'currentVersion',type:'reference',to:[{type:'applicationCvVersion'}]}),
    defineField({name:'submittedVersion',type:'reference',to:[{type:'applicationCvVersion'}]}),
    defineField({name:'run',type:'object',fields:[required('requestId','Request ID'),defineField({name:'runId',type:'string'}),defineField({name:'status',type:'string'}),defineField({name:'phase',type:'string'}),defineField({name:'model',type:'string'}),defineField({name:'fingerprint',type:'string'}),defineField({name:'startedAt',type:'datetime'}),defineField({name:'finishedAt',type:'datetime'}),defineField({name:'updatedAt',type:'datetime'}),defineField({name:'error',type:'text'}),defineField({name:'versionId',type:'string'}),defineField({name:'publication',type:'string'}),
      defineField({name:'validation',type:'object',fields:[defineField({name:'status',type:'string'}),defineField({name:'summary',type:'text'}),defineField({name:'wordCount',type:'number'}),
        defineField({name:'issues',type:'array',of:[defineArrayMember({type:'object',fields:[defineField({name:'code',type:'string'}),defineField({name:'message',type:'text'})]})]}),
        defineField({name:'requirementMap',type:'array',of:[defineArrayMember({type:'object',fields:[defineField({name:'requirement',type:'string'}),defineField({name:'status',type:'string'}),defineField({name:'evidenceIds',type:'array',of:[defineArrayMember({type:'string'})]})]})]}),
      ]})]})]})
export const applicationCvVersion=defineType({name:'applicationCvVersion',title:'Application CV version',type:'document',icon:DocumentTextIcon,readOnly:true,
  fields:[defineField({name:'binding',type:'reference',to:[{type:'applicationCvBinding'}],validation:rule=>rule.required()}),
    defineField({name:'job',type:'reference',to:[{type:'job'}]}),required('jobId','Legacy job ID'),required('requestId','Request ID'),required('fingerprint','Generation fingerprint'),defineField({name:'jobFingerprint',type:'string'}),defineField({name:'sourceFingerprint',type:'string'}),defineField({name:'versionInstructions',type:'text'}),defineField({name:'templateVersion',type:'string'}),defineField({name:'rendererVersion',type:'string'}),defineField({name:'createdAt',type:'datetime'}),
    defineField({name:'reportSnapshot',type:'applicationCvJson'}),
    defineField({name:'content',type:'applicationCvJson'}),
    defineField({name:'sourceSnapshot',type:'applicationCvJson'}),
    defineField({name:'validation',type:'applicationCvJson'}),
    defineField({name:'verification',type:'applicationCvJson'}),
    defineField({name:'usage',type:'applicationCvJson'}),
    defineField({name:'pdf',type:'file'}),defineField({name:'pdfSha256',title:'PDF SHA-256',type:'string'}),defineField({name:'model',type:'string'})]})

export const applicationCvTypes=[applicationCvJson,applicationCvRole,applicationCvEducation,applicationCvProject,applicationCvEvidence,
  applicationCvSettings,applicationCvBinding,applicationCvVersion]
