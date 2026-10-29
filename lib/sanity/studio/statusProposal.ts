import {defineField, defineType} from 'sanity'
import {EnvelopeIcon} from '@sanity/icons/Envelope'

// Written by the daily email routine through /api/admin/jobs?routine=proposal;
// state and decidedAt change only when Bernardo applies or dismisses it in the
// admin. Read-only in Studio: exclude it from creation templates and document actions.
const readOnly = (name: string, title: string, type: 'string' | 'text' | 'number' | 'datetime' = 'string') =>
  defineField({name, title, type, readOnly: true})

const stages = ['new', 'reviewing', 'applied', 'interviewing', 'offer', 'rejected', 'not_interested', 'expired']

export const statusProposal = defineType({
  name: 'statusProposal', title: 'Email status proposal', type: 'document', icon: EnvelopeIcon, readOnly: true,
  description: 'A stage change suggested from a recruiting email. Nothing changes on the job until Bernardo applies it.',
  fields: [
    readOnly('jobId', 'Pipeline job ID'),
    defineField({name: 'job', title: 'Job', type: 'reference', to: [{type: 'job'}], weak: true, readOnly: true}),
    readOnly('company', 'Company'), readOnly('role', 'Role'),
    defineField({name: 'currentStage', title: 'Stage when proposed', type: 'string', readOnly: true, options: {list: stages}}),
    defineField({name: 'proposedStage', title: 'Proposed stage', type: 'string', readOnly: true, options: {list: stages.filter(s => s !== 'new')}}),
    defineField({name: 'interview', title: 'Interview', type: 'object', readOnly: true, fields: [
      readOnly('date', 'Date or date and time'),
      readOnly('round', 'Round'),
      defineField({name: 'kind', title: 'Kind', type: 'string', readOnly: true, options: {list: ['phone', 'video', 'onsite', 'assessment', 'other']}}),
      readOnly('notes', 'Notes', 'text'),
    ]}),
    readOnly('summary', 'Summary', 'text'),
    defineField({name: 'email', title: 'Email evidence', type: 'object', readOnly: true, fields: [
      readOnly('threadId', 'Gmail thread ID'), readOnly('messageId', 'Gmail message ID'),
      readOnly('subject', 'Subject'), readOnly('from', 'From'), readOnly('fromAddress', 'Sender address'),
      readOnly('date', 'Sent', 'datetime'),
      defineField({name: 'link', title: 'Open in Gmail', type: 'url', readOnly: true}),
    ]}),
    defineField({name: 'matchedBy', title: 'Matched by', type: 'string', readOnly: true,
      options: {list: ['thread', 'recruiter', 'domain', 'company']}}),
    readOnly('confidence', 'Routine confidence', 'number'),
    defineField({name: 'state', title: 'State', type: 'string', readOnly: true,
      options: {list: [{title: 'Open', value: 'open'}, {title: 'Applied', value: 'applied'}, {title: 'Dismissed', value: 'dismissed'}]}}),
    defineField({name: 'appliedFromStage', title: 'Stage before applying', type: 'string', readOnly: true, options: {list: stages}}),
    readOnly('createdAt', 'Proposed', 'datetime'),
    readOnly('decidedAt', 'Decided', 'datetime'),
  ],
  orderings: [{title: 'Proposed', name: 'createdAtDesc', by: [{field: 'createdAt', direction: 'desc'}]}],
  preview: {select: {title: 'summary', company: 'company', proposedStage: 'proposedStage', state: 'state'},
    prepare: ({title, company, proposedStage, state}) => ({title, subtitle: [company, proposedStage, state].filter(Boolean).join(' · ')})},
})
