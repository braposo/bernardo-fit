// Run with node --env-file=.env.local scripts/seed-chat-settings.mjs.
// createIfNotExists preserves every existing published setting and draft.
import { createStorageClient } from '../lib/sanity/client.js';
import { initialChatSettingsDocument } from '../lib/chat/settings-defaults.js';
import { chatSettingsFromDocument } from '../lib/chat/settings.js';
const document = initialChatSettingsDocument();
chatSettingsFromDocument(document);
const client = createStorageClient();
if (await client.getDocument(document._id)) console.log('Chat settings already exist; left unchanged.');
else {
  await client.createIfNotExists(document);
  console.log('Published the existing chat configuration as Chat settings.');
}
