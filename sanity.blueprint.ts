import { defineBlueprint, defineScheduledFunction } from '@sanity/blueprints';

// Credentials are configured in the deployed function, never in this manifest.
export default defineBlueprint({ resources: [defineScheduledFunction({
  name: 'classify-conversations', src: 'functions/classify-conversations',
  timeout: 360, memory: 1, event: { expression: '0 * * * *' },
})] });
