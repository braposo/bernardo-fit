import {defineArrayMember, defineField} from 'sanity'
import {SearchIcon} from '@sanity/icons/Search'

const number = (name: string, title: string, min: number, max: number, description?: string) => defineField({
  name, title, type: 'number', description, validation: rule => rule.required().integer().min(min).max(max),
})

// Add to the analysisSettings document, in the linkedin group beside linkedinScreening.
export const jsearchDiscovery = defineField({
  name: 'jsearchDiscovery', title: 'JSearch discovery', group: 'linkedin', type: 'object', icon: SearchIcon,
  description: 'Daily search across job boards through JSearch (Google for Jobs), at 09:15 London after the LinkedIn scan. Needs JSEARCH_API_KEY in Trigger. Results go through the same dedupe, scoring and Filtered rules as LinkedIn. Each page is one paid request.',
  fields: [
    defineField({name: 'enabled', title: 'Enable daily JSearch discovery', type: 'boolean',
      description: 'Disabled or unpublished runs stop before any paid request.',
      validation: rule => rule.required()}),
    defineField({name: 'searches', title: 'Searches', type: 'array',
      of: [defineArrayMember({type: 'object', fields: [
        defineField({name: 'query', title: 'Query', type: 'string',
          description: 'Free text, as typed into Google for Jobs, e.g. "Engineering Manager in United Kingdom".',
          validation: rule => rule.required().max(200).custom(value => !value || !!value.trim() || 'Enter a query.')}),
        defineField({name: 'country', title: 'Country code', type: 'string', initialValue: 'gb',
          validation: rule => rule.required().regex(/^[a-z]{2}$/, {name: 'two-letter lowercase code'})}),
        defineField({name: 'datePosted', title: 'Posted within', type: 'string', initialValue: '3days',
          options: {list: [{title: 'Today', value: 'today'}, {title: 'Last 3 days', value: '3days'},
            {title: 'Last week', value: 'week'}, {title: 'Last month', value: 'month'}]},
          validation: rule => rule.required()}),
      ]})], validation: rule => rule.required().min(1).max(10)}),
    number('pagesPerSearch', 'Pages per search', 1, 5, 'Ten results a page; each page is one paid request.'),
    number('maxAssessmentsPerRun', 'Maximum full assessments per run', 1, 60,
      'New postings beyond this wait for the next run, while still inside the posted-within window.'),
    number('requestTimeoutSeconds', 'Request timeout (seconds)', 5, 60),
    defineField({name: 'retry', title: 'Trigger request retry policy', type: 'object', validation: rule => rule.required(), fields: [
      number('maxAttempts', 'Maximum attempts (including the first)', 1, 5),
      number('minTimeoutInMs', 'Initial retry delay (milliseconds)', 1000, 3600000),
      number('maxTimeoutInMs', 'Maximum retry delay (milliseconds)', 1000, 3600000),
      defineField({name: 'factor', title: 'Backoff factor', type: 'number', validation: rule => rule.required().min(1).max(5)}),
      defineField({name: 'randomize', title: 'Randomize retry delays', type: 'boolean', validation: rule => rule.required()}),
    ]}),
  ],
})
