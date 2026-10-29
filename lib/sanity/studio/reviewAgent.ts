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
  description: 'After a job is admitted at New, Jev suggests whether to move it forward, drop it or ask you. Shadow mode unless an automatic switch is on: the suggestion is recorded next to your own call. Changing these does not mark fit assessments outdated.',
  fields: [
    toggle('enabled', 'Review new jobs', 'Disabled or unpublished, no job is reviewed and no Jev request is made.'),
    threshold('advanceThreshold', 'Move-forward probability', 'Suggest moving forward at or above this probability, when no hard-constraint check is flagged. 0.5 to 0.99.'),
    threshold('dropThreshold', 'Drop probability', 'Suggest dropping at or above this probability. 0.5 to 0.99.'),
    toggle('autoAdvance', 'Move forward automatically', 'Move a job the agent would move forward to Reviewing itself, while the agreement gate below is met.'),
    toggle('autoDrop', 'Drop automatically', 'Move a job the agent would drop to Not interested itself (it goes to Archive and can be restored), while the agreement gate below is met.'),
    defineField({name: 'exampleCount', title: 'Past decisions shown as examples', type: 'number', initialValue: 5,
      description: 'The most similar earlier calls (by company, title and score), with your reasons. 0 to 10.',
      validation: rule => rule.required().integer().min(0).max(10)}),
    defineField({name: 'autoMinimumAgreement', title: 'Agreement needed for automatic moves', type: 'number', initialValue: 0.85,
      description: 'Automatic moves happen only while you agreed with at least this share of the agent\'s confident suggestions over your latest 100 such calls. 0.5 to 1. Leave empty to keep the agent in shadow mode.',
      validation: rule => rule.min(0.5).max(1)}),
    defineField({name: 'autoMinimumDecided', title: 'Calls needed for automatic moves', type: 'number', initialValue: 20,
      description: 'And only once at least this many of those calls exist. 5 to 100. Leave empty to keep the agent in shadow mode.',
      validation: rule => rule.integer().min(5).max(100)}),
    defineField({name: 'learnPreferences', title: 'Learn preferences weekly', type: 'boolean', initialValue: false,
      description: 'Each Monday, propose plain-language rules from your recent decisions. Proposed rules wait in Needs you; only rules you accept reach the agent.'}),
  ],
})
