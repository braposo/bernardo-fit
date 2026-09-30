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
    defineField({name: 'retryMinutes', title: 'Retry delays (minutes)', type: 'array',
      description: 'Up to three increasing delays. An empty list disables retries. LinkedIn Retry-After values take precedence when longer.',
      of: [defineArrayMember({type: 'number', validation: rule => rule.integer().min(1).max(60)})],
      validation: rule => rule.required().max(3).custom(value => !value || value.every((v, i) => typeof v === 'number' && (!i || v >= Number(value[i - 1])))
        || 'Retry delays must not decrease.')}),
    number('requestBudgetMinutes', 'Request-time budget per run (minutes)', 1, 120),
  ],
})
