import {defineArrayMember, defineField, defineType} from 'sanity'
import {CheckmarkCircleIcon} from '@sanity/icons/CheckmarkCircle'

// Written by the admin when Bernardo moves a job out of New. Read-only in
// Studio: exclude it from creation templates and document actions.
const readOnly = (name: string, title: string, type: 'string' | 'text' | 'number' | 'datetime' = 'string') =>
  defineField({name, title, type, readOnly: true})

const stages = ['new', 'reviewing', 'applied', 'interviewing', 'offer', 'rejected', 'not_interested', 'expired']

export const reviewDecision = defineType({
  name: 'reviewDecision', title: 'Review decision', type: 'document', icon: CheckmarkCircleIcon, readOnly: true,
  description: 'Bernardo\'s call on a job leaving New, with his reasons. Kept so a future review agent can learn from it.',
  fields: [
    readOnly('jobId', 'Pipeline job ID'),
    readOnly('company', 'Company'), readOnly('role', 'Role'),
    readOnly('score', 'Fit score at the time', 'number'),
    readOnly('source', 'Source'),
    defineField({name: 'sourceUrl', title: 'Posting', type: 'url', readOnly: true}),
    defineField({name: 'fromStage', title: 'From stage', type: 'string', readOnly: true, options: {list: stages}}),
    defineField({name: 'toStage', title: 'To stage', type: 'string', readOnly: true, options: {list: stages}}),
    defineField({name: 'direction', title: 'Direction', type: 'string', readOnly: true,
      options: {list: [{title: 'Advance', value: 'advance'}, {title: 'Drop', value: 'drop'}, {title: 'Other', value: 'other'}]}}),
    defineField({name: 'reasons', title: 'Reasons', type: 'array', readOnly: true, of: [defineArrayMember({type: 'string'})]}),
    readOnly('note', 'Note', 'text'),
    defineField({name: 'agentLean', title: 'Review agent lean', type: 'string', readOnly: true,
      options: {list: ['advance', 'drop']}}),
    readOnly('agentProbability', 'Review agent confidence', 'number'),
    defineField({name: 'decidedBy', title: 'Decided by', type: 'string', readOnly: true,
      description: 'The review agent\'s automatic moves never count as Bernardo\'s call. Missing on older records, which are his.',
      options: {list: [{title: 'Bernardo', value: 'bernardo'}, {title: 'Review agent', value: 'agent'}]}}),
    defineField({name: 'overridesAgent', title: 'Undid an agent move', type: 'boolean', readOnly: true}),
    readOnly('decidedAt', 'Decided', 'datetime'),
  ],
  orderings: [{title: 'Decided', name: 'decidedAtDesc', by: [{field: 'decidedAt', direction: 'desc'}]}],
  preview: {select: {title: 'role', company: 'company', direction: 'direction', toStage: 'toStage'},
    prepare: ({title, company, direction, toStage}) => ({title, subtitle: [company, direction, toStage].filter(Boolean).join(' · ')})},
})
