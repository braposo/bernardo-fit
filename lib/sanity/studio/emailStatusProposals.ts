import {defineField} from 'sanity'
import {EnvelopeIcon} from '@sanity/icons/Envelope'

// Add to the analysisSettings document, in the jev group beside reviewAgent.
export const emailStatusProposals = defineField({
  name: 'emailStatusProposals', title: 'Email status proposals', group: 'jev', type: 'object', icon: EnvelopeIcon,
  description: 'Recruiting email is read once a day and turned into proposed stage changes and interview dates. Proposals wait in Needs you; nothing changes until you apply one. Changing these does not mark fit assessments outdated.',
  fields: [
    defineField({name: 'enabled', title: 'Accept proposals', type: 'boolean', initialValue: false,
      description: 'Disabled or unpublished, new proposals are refused, from the Claude routine and the Gmail check alike. Proposals already saved can still be applied or dismissed.',
      validation: rule => rule.required()}),
    defineField({name: 'minimumConfidence', title: 'Minimum confidence', type: 'number', initialValue: 0.6,
      description: 'Proposals the reader is less sure about than this are not saved. 0.3 to 0.99.',
      validation: rule => rule.required().min(0.3).max(0.99)}),
    defineField({name: 'gmailCheck', title: 'Gmail check (Trigger)', type: 'object',
      description: 'The daily Trigger task that reads Gmail itself, 07:10 London. Leave off while the Claude routine is in use.',
      fields: [
        defineField({name: 'enabled', title: 'Run the Gmail check', type: 'boolean', initialValue: false,
          description: 'Off or missing, the task makes no Gmail or model request. Needs Accept proposals on as well.',
          validation: rule => rule.required()}),
        defineField({name: 'query', title: 'Gmail search', type: 'string',
          description: 'Gmail search syntax. Keep newer_than:3d, -from:me and the category exclusions.',
          validation: rule => rule.required().min(1).max(500)}),
        defineField({name: 'maxMessages', title: 'Messages per run', type: 'number', initialValue: 40,
          description: 'The newest messages the search returns that are read each run. 1 to 100.',
          validation: rule => rule.required().integer().min(1).max(100)}),
        defineField({name: 'skipSenders', title: 'Skip senders', type: 'array', of: [{type: 'string'}],
          description: 'Addresses (jobalerts-noreply@linkedin.com) or domains (totaljobs.com, subdomains included) that only send alerts or newsletters. Skipped before any model call.',
          validation: rule => rule.required().max(200)}),
      ],
    }),
  ],
})
