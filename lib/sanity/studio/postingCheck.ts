import {defineField} from 'sanity'
import {SearchIcon} from '@sanity/icons/Search'

const toggle = (name: string, title: string, description: string, initialValue: boolean) => defineField({
  name, title, type: 'boolean', description, initialValue, validation: rule => rule.required(),
})

// Add to the analysisSettings document, in the jev group beside reviewAgent.
export const postingCheck = defineField({
  name: 'postingCheck', title: 'Posting check', group: 'jev', type: 'object', icon: SearchIcon,
  description: 'At Reviewing, find the employer application page and prepare a checklist of its fields, files and answers. Nothing is submitted.',
  fields: [
    defineField({name: 'discoveryPrompt', title: 'Application discovery prompt', type: 'text', validation: rule => rule.required()}),
    defineField({name: 'discoveryModel', title: 'Application discovery model', type: 'string', validation: rule => rule.required()}),
    defineField({name: 'maxDiscoverySearches', title: 'Maximum searches per discovery', type: 'number', validation: rule => rule.required().integer().min(1).max(8)}),
    toggle('enabled', 'Check postings at Reviewing', 'Disabled or unpublished, no posting is checked, no form is fetched and no answer is drafted.', false),
    defineField({name: 'gapThreshold', title: 'Legacy gap probability (unused)', hidden: true, type: 'number', initialValue: 0.5,
      description: 'A topic counts as missing when Jev’s probability that the posting states it is below this. 0.1 to 0.9.',
      validation: rule => rule.required().min(0.1).max(0.9)}),
    toggle('fetchApplicationForms', 'Read public application forms', 'Find the employer link and inspect public form fields. Login, blocked and multi-step forms remain incomplete.', true),
    toggle('draftAnswers', 'Draft form answers', 'Uses the existing application answer writer once the fit page exists. Drafts wait for your approval.', true),
    defineField({name: 'maxDraftAnswers', title: 'Most answers drafted per job', type: 'number', initialValue: 8,
      description: 'Questions beyond this wait for you undrafted. 0 to 20.',
      validation: rule => rule.required().integer().min(0).max(20)}),
    defineField({name: 'requestTimeoutSeconds', title: 'Form request timeout (seconds)', type: 'number', initialValue: 20,
      description: 'One request per attempt; Trigger retries. 5 to 60.',
      validation: rule => rule.required().integer().min(5).max(60)}),
  ],
})
