import {defineArrayMember, defineField, defineType} from 'sanity'
import {FilterIcon} from '@sanity/icons/Filter'

// Written by the app's automatic screens; reviewed and moved in the admin.
// Read-only in Studio: exclude it from creation templates and document actions.
const readOnly = (name: string, title: string, type: 'string' | 'text' | 'number' | 'datetime' | 'boolean' = 'string') =>
  defineField({name, title, type, readOnly: true})

export const filteredJob = defineType({
  name: 'filteredJob', title: 'Filtered job', type: 'document', icon: FilterIcon, readOnly: true,
  description: 'A job the automatic screens analysed and kept out of the pipeline. Move it from the admin Filtered view.',
  fields: [
    readOnly('identity', 'Pipeline job ID'),
    readOnly('company', 'Company'), readOnly('role', 'Role'), readOnly('location', 'Location'),
    defineField({name: 'sourceUrl', title: 'Posting', type: 'url', readOnly: true}),
    readOnly('externalId', 'External ID'), readOnly('source', 'Source'), readOnly('postedDate', 'Visible posting date'),
    defineField({name: 'stage', title: 'Screen', type: 'string', readOnly: true,
      options: {list: [{title: 'Title screen', value: 'title'}, {title: 'Full assessment', value: 'assessment'}]}}),
    defineField({name: 'decision', title: 'Decision', type: 'string', readOnly: true,
      options: {list: ['title-mismatch', 'below-threshold', 'constraint-conflict', 'needs-review']}}),
    readOnly('score', 'Fit score', 'number'), readOnly('minimumScore', 'Admission threshold at the time', 'number'),
    readOnly('relevanceProbability', 'Title screen relevance', 'number'),
    readOnly('reason', 'Why it was filtered', 'text'),
    defineField({name: 'dimensions', title: 'Dimension scores', type: 'array', readOnly: true,
      of: [defineArrayMember({type: 'object', fields: [
        defineField({name: 'id', type: 'string'}), defineField({name: 'label', type: 'string'}),
        defineField({name: 'score', type: 'number'}), defineField({name: 'weight', type: 'number'}),
      ]})]}),
    readOnly('hasDescription', 'Full description saved', 'boolean'),
    readOnly('opportunity', 'Saved posting (JSON)', 'text'),
    readOnly('assessment', 'Saved assessment (JSON)', 'text'),
    readOnly('firstFilteredAt', 'First filtered', 'datetime'), readOnly('filteredAt', 'Last filtered', 'datetime'),
    readOnly('movedAt', 'Moved to pipeline', 'datetime'), readOnly('movedJobId', 'Pipeline job'),
  ],
  orderings: [{title: 'Last filtered', name: 'filteredAtDesc', by: [{field: 'filteredAt', direction: 'desc'}]}],
  preview: {select: {title: 'role', subtitle: 'company', score: 'score', decision: 'decision'},
    prepare: ({title, subtitle, score, decision}) => ({title, subtitle: [subtitle, score ?? decision].filter(v => v !== undefined && v !== null).join(' · ')})},
})

// Add to the analysisSettings document, in the Jev group beside ingestMinimumScore.
export const filteredJobRetentionDays = defineField({
  name: 'filteredJobRetentionDays', title: 'Keep filtered jobs (days)', group: 'jev', type: 'number', initialValue: 90,
  description: 'Filtered jobs not seen again within this many days are removed after the daily discovery run. Leave unpublished to keep them all.',
  validation: rule => rule.integer().min(7).max(365),
})
