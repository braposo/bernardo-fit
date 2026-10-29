import {defineArrayMember, defineField, defineType} from 'sanity'
import {DocumentTextIcon} from '@sanity/icons/DocumentText'

// One document (_id "review-preferences"), written by the weekly
// learn-preferences task and by Bernardo's accept, edit, reject and delete in
// the admin. Read-only in Studio: exclude it from creation templates and
// document actions.
const readOnly = (name: string, title: string, type: 'string' | 'text' | 'datetime' = 'string') =>
  defineField({name, title, type, readOnly: true})

export const reviewPreferences = defineType({
  name: 'reviewPreferences', title: 'Learned preferences', type: 'document', icon: DocumentTextIcon, readOnly: true,
  description: 'Plain-language rules about how Bernardo reviews jobs, proposed from his review decisions. Only accepted rules reach the review agent.',
  fields: [
    defineField({name: 'rules', title: 'Rules', type: 'array', readOnly: true, of: [defineArrayMember({
      type: 'object', name: 'preferenceRule', fields: [
        readOnly('id', 'Rule ID'),
        readOnly('text', 'Proposed rule', 'text'),
        readOnly('editedText', 'Bernardo\'s wording', 'text'),
        defineField({name: 'state', title: 'State', type: 'string', readOnly: true,
          options: {list: [{title: 'Proposed', value: 'proposed'}, {title: 'Accepted', value: 'accepted'}, {title: 'Rejected', value: 'rejected'}]}}),
        defineField({name: 'sourceDecisionIds', title: 'From review decisions', type: 'array', readOnly: true, of: [defineArrayMember({type: 'string'})]}),
        readOnly('createdAt', 'Proposed', 'datetime'),
        readOnly('decidedAt', 'Decided', 'datetime'),
      ],
      preview: {select: {title: 'text', edited: 'editedText', state: 'state'},
        prepare: ({title, edited, state}) => ({title: edited || title, subtitle: state})},
    })]}),
    readOnly('lastLearnedAt', 'Last learned', 'datetime'),
    readOnly('lastDecisionAt', 'Newest decision read', 'datetime'),
  ],
  preview: {prepare: () => ({title: 'Learned preferences'})},
})
