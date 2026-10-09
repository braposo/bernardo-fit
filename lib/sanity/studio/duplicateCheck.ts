import {defineField} from 'sanity'
import {CopyIcon} from '@sanity/icons/Copy'

const text = (name: string, title: string) => defineField({
  name, title, type: 'text', rows: name === 'instructions' ? 8 : 3,
  validation: rule => rule.required().max(8000).custom(value => !value || !!value.trim() || 'Enter non-empty text.'),
})

// Add to the analysisSettings document, in the Jev group beside filteredJobRetentionDays.
export const duplicateCheck = defineField({
  name: 'duplicateCheck', title: 'Repost check', group: 'jev', type: 'object', icon: CopyIcon,
  description: 'Scans and imports skip reposts of jobs already in the pipeline, archive or Filtered. Same company, title and place is always a repost; Jev compares the descriptions for close calls (same title in another city, or a reworded title). Leave unpublished to apply only the fixed rule.',
  fields: [
    defineField({name: 'repeatProbability', title: 'Minimum repost probability', type: 'number',
      description: 'Jev must be at least this sure a close call is the same opening before it is treated as a repost.',
      validation: rule => rule.required().min(0.5).max(1)}),
    defineField({name: 'maxComparisons', title: 'Existing jobs compared per posting', type: 'number',
      validation: rule => rule.required().integer().min(1).max(8)}),
    text('instructions', 'Jev repost instructions'),
    text('repeatCriteria', 'Same opening'),
    text('differentCriteria', 'Different opening'),
  ],
})
