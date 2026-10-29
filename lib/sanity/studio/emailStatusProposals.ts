import {defineField} from 'sanity'
import {EnvelopeIcon} from '@sanity/icons/Envelope'

// Add to the analysisSettings document, in the jev group beside reviewAgent.
export const emailStatusProposals = defineField({
  name: 'emailStatusProposals', title: 'Email status proposals', group: 'jev', type: 'object', icon: EnvelopeIcon,
  description: 'A daily Claude routine reads recruiting email and proposes stage changes and interview dates. Proposals wait in Needs you; nothing changes until you apply one. Changing these does not mark fit assessments outdated.',
  fields: [
    defineField({name: 'enabled', title: 'Accept proposals', type: 'boolean', initialValue: false,
      description: 'Disabled or unpublished, the routine\'s new proposals are refused. Proposals already saved can still be applied or dismissed.',
      validation: rule => rule.required()}),
    defineField({name: 'minimumConfidence', title: 'Minimum confidence', type: 'number', initialValue: 0.6,
      description: 'Proposals the routine is less sure about than this are not saved. 0.3 to 0.99.',
      validation: rule => rule.required().min(0.3).max(0.99)}),
  ],
})
