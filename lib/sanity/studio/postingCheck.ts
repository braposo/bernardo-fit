import {defineField} from 'sanity'
import {SearchIcon} from '@sanity/icons/Search'

const toggle = (name: string, title: string, description: string, initialValue: boolean) => defineField({
  name, title, type: 'boolean', description, initialValue, validation: rule => rule.required(),
})

// Add to the analysisSettings document, in the jev group beside reviewAgent.
export const postingCheck = defineField({
  name: 'postingCheck', title: 'Posting check', group: 'jev', type: 'object', icon: SearchIcon,
  description: 'When a job moves to Reviewing, Jev looks for what the posting leaves out (salary, location and office days, seniority or team size, visa or contract terms), and the public application form of Greenhouse jobs is read and answered as drafts. Nothing is ever submitted: gaps and drafts wait in Needs you. Changing these does not mark fit assessments outdated.',
  fields: [
    toggle('enabled', 'Check postings at Reviewing', 'Disabled or unpublished, no posting is checked, no form is fetched and no answer is drafted.', false),
    defineField({name: 'gapThreshold', title: 'Gap probability', type: 'number', initialValue: 0.5,
      description: 'A topic counts as missing when Jev’s probability that the posting states it is below this. 0.1 to 0.9.',
      validation: rule => rule.required().min(0.1).max(0.9)}),
    toggle('fetchApplicationForms', 'Read public application forms', 'Greenhouse, Lever and Ashby public job-board APIs only. Other sites: paste the questions.', true),
    toggle('draftAnswers', 'Draft form answers', 'Uses the existing application answer writer once the fit page exists. Drafts wait for your approval.', true),
    defineField({name: 'maxDraftAnswers', title: 'Most answers drafted per job', type: 'number', initialValue: 8,
      description: 'Questions beyond this wait for you undrafted. 0 to 20.',
      validation: rule => rule.required().integer().min(0).max(20)}),
    defineField({name: 'requestTimeoutSeconds', title: 'Form request timeout (seconds)', type: 'number', initialValue: 20,
      description: 'One request per attempt; Trigger retries. 5 to 60.',
      validation: rule => rule.required().integer().min(5).max(60)}),
  ],
})
