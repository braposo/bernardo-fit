import {defineField} from 'sanity'
import {CheckmarkCircleIcon} from '@sanity/icons/CheckmarkCircle'

const threshold = (name: string, title: string, description: string) => defineField({
  name, title, type: 'number', description, initialValue: 0.85,
  validation: rule => rule.required().min(0.5).max(0.99),
})
const toggle = (name: string, title: string, description: string) => defineField({
  name, title, type: 'boolean', description, initialValue: false, validation: rule => rule.required(),
})

// Add to the analysisSettings document, in the jev group beside reviewReasons.
export const reviewAgent = defineField({
  name: 'reviewAgent', title: 'Review agent', group: 'jev', type: 'object', icon: CheckmarkCircleIcon,
  description: 'After a job is admitted at New, Jev suggests whether to move it forward, drop it or ask you. Shadow mode: the suggestion is recorded next to your own call and never changes a stage. Changing these does not mark fit assessments outdated.',
  fields: [
    toggle('enabled', 'Review new jobs', 'Disabled or unpublished, no job is reviewed and no Jev request is made.'),
    threshold('advanceThreshold', 'Move-forward probability', 'Suggest moving forward at or above this probability, when no hard-constraint check is flagged. 0.5 to 0.99.'),
    threshold('dropThreshold', 'Drop probability', 'Suggest dropping at or above this probability. 0.5 to 0.99.'),
    toggle('autoAdvance', 'Move forward automatically', 'Not used yet: suggestions are recorded only.'),
    toggle('autoDrop', 'Drop automatically', 'Not used yet: suggestions are recorded only.'),
    defineField({name: 'exampleCount', title: 'Past decisions shown as examples', type: 'number', initialValue: 5,
      description: 'The most similar earlier calls (by company, title and score), with your reasons. 0 to 10.',
      validation: rule => rule.required().integer().min(0).max(10)}),
  ],
})
