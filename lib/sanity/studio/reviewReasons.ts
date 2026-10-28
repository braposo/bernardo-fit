import {defineArrayMember, defineField} from 'sanity'
import {CheckmarkCircleIcon} from '@sanity/icons/CheckmarkCircle'

const reasons = (name: 'advance' | 'drop', title: string, description: string) => defineField({
  name, title, type: 'array', description,
  of: [defineArrayMember({type: 'string', validation: rule => rule.required().max(60)
    .custom(value => !value || !!value.trim() || 'Enter a reason.')})],
  validation: rule => rule.required().min(1).max(12).unique(),
})

// Add to the analysisSettings document, in the jev group beside ingestMinimumScore.
export const reviewReasons = defineField({
  name: 'reviewReasons', title: 'Review quick-pick reasons', group: 'jev', type: 'object', icon: CheckmarkCircleIcon,
  description: 'Reasons offered as one-tap picks when a job leaves New in the admin. Saved choices become review decisions a future review agent can learn from. Changing these does not mark fit assessments outdated.',
  fields: [
    reasons('advance', 'Reasons to move forward', 'Offered when a job moves to Reviewing, Applied, Interviewing or Offer.'),
    reasons('drop', 'Reasons to drop', 'Offered when a job moves to Not interested.'),
  ],
})
