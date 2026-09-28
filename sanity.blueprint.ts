import { defineBlueprint, defineScheduledFunction } from '@sanity/blueprints';

// Credentials are configured in the deployed function, never in this manifest.
export default defineBlueprint({ resources: [defineScheduledFunction({
  name: 'classify-conversations', src: 'functions/classify-conversations',
  timeout: 360, memory: 1, event: { expression: '0 * * * *' },
}), defineScheduledFunction({
  name: 'discover-linkedin', src: 'functions/discover-linkedin',
  timeout: 60, memory: 1,
  // Sanity cron is UTC. The handler admits only 09:00 Europe/London, covering BST/GMT.
  event: { expression: '0 8,9 * * *' },
})] });
