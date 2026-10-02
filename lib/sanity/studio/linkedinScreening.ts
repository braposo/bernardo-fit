import {defineArrayMember, defineField} from 'sanity'
import {CogIcon} from '@sanity/icons/Cog'

const number = (name: string, title: string, min: number, max: number) => defineField({
  name, title, type: 'number', validation: rule => rule.required().integer().min(min).max(max),
})
const text = (name: string, title: string) => defineField({
  name, title, type: 'text', rows: name === 'instructions' ? 10 : 3,
  validation: rule => rule.required().max(8000).custom(value => !value || !!value.trim() || 'Enter non-empty text.'),
})

export const linkedinScreening = defineField({
  name: 'linkedinScreening', title: 'LinkedIn discovery and screening', group: 'linkedin', type: 'object', icon: CogIcon,
  description: 'Daily Engineering Manager discovery. Keep disabled until the compatible worker is deployed and checked. Uncertain cards are deferred; confident relevant cards proceed to a full description and normal admission.',
  validation: rule => rule.required(),
  fields: [
    defineField({name: 'policyVersion', title: 'Policy version', type: 'number', readOnly: true,
      validation: rule => rule.required().valid(2)}),
    defineField({name: 'enabled', title: 'Enable daily discovery', type: 'boolean',
      description: 'Publish only after the compatible production worker has been checked. Disabled runs stop before public requests.',
      validation: rule => rule.required()}),
    defineField({name: 'searches', title: 'Public searches', type: 'array',
      description: 'Initially one UK-wide Engineering Manager search. Working arrangements are assessed later, not filtered in search. Avoid expanding role scope without reviewing discovery policy.',
      of: [defineArrayMember({type: 'object', fields: [
        defineField({name: 'keywords', title: 'Keywords', type: 'string',
          validation: rule => rule.required().max(120).custom(value => !value || !!value.trim() || 'Enter keywords.')}),
        defineField({name: 'location', title: 'Location', type: 'string',
          validation: rule => rule.required().max(120).custom(value => !value || !!value.trim() || 'Enter a location.')}),
      ]})], validation: rule => rule.required().min(1).max(5)}),
    number('searchPageSize', 'Public results per page', 1, 60),
    number('maxSearchPages', 'Safety limit for pages per daily search', 1, 40),
    defineField({name: 'maxSearchResults', title: 'Newest unique results per daily search', type: 'number',
      description: 'Stop after this many distinct posting IDs for each configured search. Reaching this limit completes the configured daily scope, not the entire LinkedIn market.',
      validation: rule => rule.required().integer().min(1).max(400)}),
    defineField({name: 'relevanceProbability', title: 'Minimum positive relevance probability', type: 'number',
      description: 'Only a confident Engineering Manager match advances to the full description. Uncertain cards are deferred.',
      validation: rule => rule.required().min(0.5).max(1)}),
    text('instructions', 'Jev preliminary relevance instructions'),
    text('investigateCriteria', 'Positive Engineering Manager evidence'),
    text('mismatchCriteria', 'Clear unrelated role evidence'),
    number('requestTimeoutSeconds', 'Trigger HTTP timeout (seconds)', 1, 45),
    defineField({name: 'retry', title: 'Trigger request retry policy', type: 'object',
      description: 'Native Trigger task retry options. Each request is a separate task with its own attempts and trace. Retry-After can override the next retry time.',
      validation: rule => rule.required(), fields: [
        number('maxAttempts', 'Maximum attempts (including the first)', 1, 4),
        number('minTimeoutInMs', 'Initial retry delay (milliseconds)', 60000, 3600000),
        defineField({name: 'maxTimeoutInMs', title: 'Maximum retry delay (milliseconds)', type: 'number',
          validation: rule => rule.required().integer().min(60000).max(3600000).custom((value, context) =>
            value === undefined || value >= Number((context.parent as {minTimeoutInMs?: number})?.minTimeoutInMs || 60000)
              || 'Must be at least the initial delay.')}),
        defineField({name:'factor',title:'Backoff factor',type:'number',validation:rule=>rule.required().min(1).max(5)}),
        defineField({name:'randomize',title:'Randomize retry delays',type:'boolean',validation:rule=>rule.required()}),
      ]}),
    // Preserve v1 values without presenting inactive controls.
    defineField({name: 'resultsPerSearch', title: 'Retired single-page result limit', type: 'number', hidden: true, readOnly: true}),
    defineField({name: 'mismatchProbability', title: 'Retired mismatch probability', type: 'number', hidden: true, readOnly: true}),
    defineField({name: 'requestMinSeconds', title: 'Retired minimum request pause', type: 'number', hidden: true, readOnly: true}),
    defineField({name: 'requestMaxSeconds', title: 'Retired maximum request pause', type: 'number', hidden: true, readOnly: true}),
    defineField({name:'retryMinutes',title:'Retired custom retry schedule',type:'array',hidden:true,readOnly:true,
      of:[defineArrayMember({type:'number'})]}),
    defineField({name:'requestBudgetMinutes',title:'Retired wall-clock budget',type:'number',hidden:true,readOnly:true}),
  ],
})
