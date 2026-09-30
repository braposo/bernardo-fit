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
  description: 'Publish to apply to the next daily run. Uncertain cards proceed to a full description and the normal minimum-score validation.',
  validation: rule => rule.required(),
  fields: [
    number('resultsPerSearch', 'Newest results per search', 1, 60),
    defineField({name: 'mismatchProbability', title: 'Minimum mismatch probability to skip', type: 'number',
      description: '0.9 means at least 90% probability of a clear mismatch. Lower values discard more jobs before reading their descriptions.',
      validation: rule => rule.required().min(0.5).max(1)}),
    text('instructions', 'Jev preliminary screening instructions'),
    text('investigateCriteria', 'When to investigate'),
    text('mismatchCriteria', 'What counts as a clear mismatch'),
    number('requestMinSeconds', 'Minimum pause between requests (seconds)', 30, 300),
    defineField({name: 'requestMaxSeconds', title: 'Maximum pause between requests (seconds)', type: 'number',
      validation: rule => rule.required().integer().min(30).max(300).custom((value, context) =>
        value === undefined || value >= Number((context.parent as {requestMinSeconds?: number})?.requestMinSeconds || 30)
          || 'Must be at least the minimum pause.')}),
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
    // Retain old values for migration/audit without exposing inactive controls.
    defineField({name:'retryMinutes',title:'Retired custom retry schedule',type:'array',hidden:true,readOnly:true,
      of:[defineArrayMember({type:'number'})]}),
    defineField({name:'requestBudgetMinutes',title:'Retired wall-clock budget',type:'number',hidden:true,readOnly:true}),
  ],
})
