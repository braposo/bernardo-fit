import {defineField} from 'sanity'

// Add this field to the existing sitePage schema. The public CV source remains
// editable in its own fields; this is the last successfully rendered output.
export const generalCvField=defineField({
  name:'generalCv',title:'Generated general CV',type:'object',readOnly:true,
  description:'Published together with the downloadable PDF by the general CV refresh task.',
  fields:[
    defineField({name:'content',title:'Saved CV content',type:'applicationCvJson'}),
    defineField({name:'sourceFingerprint',title:'Source fingerprint',type:'string'}),
    defineField({name:'pdfSha256',title:'PDF SHA-256',type:'string'}),
    defineField({name:'pdfAssetId',title:'PDF asset ID',type:'string'}),
    defineField({name:'rendererVersion',title:'Renderer version',type:'string'}),
    defineField({name:'templateVersion',title:'Template version',type:'string'}),
    defineField({name:'generatedAt',title:'Generated at',type:'datetime'}),
    defineField({name:'runId',title:'Trigger run ID',type:'string'}),
    defineField({name:'usage',title:'Usage and AI cost',type:'applicationCvJson'}),
  ],
})
