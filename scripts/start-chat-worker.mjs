import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const branch = process.argv[2] || 'codex/sanity-context-chat-setup';
const allowed = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'TYPESAFE_API_KEY', 'SANITY_CONTEXT_MCP_URL',
  'SANITY_ORGANIZATION_TOKEN', 'SANITY_CONTEXT_WRITE_TOKEN', 'ADMIN_CHAT_INSIGHTS_ENABLED'];
const values = {};
for (const file of ['.env.development.local', '.env.context.local']) {
  if (!existsSync(file)) continue;
  const parsed = parseEnv(readFileSync(file, 'utf8'));
  for (const name of allowed) if (parsed[name]) values[name] = parsed[name];
}
// Additional Development environment credentials (including Redis) come from Trigger.
// Never include the app's admin secret or change other workers' environment files.
const envFile = '.env.chat-worker.local';
writeFileSync(envFile, Object.entries(values).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join('\n') + '\n');
const child = spawn(process.execPath, [fileURLToPath(import.meta.resolve('trigger.dev')), 'dev',
  '--branch', branch, '--env-file', envFile, '--skip-update-check'], { stdio: 'inherit' });
child.on('error', () => { console.error('Could not start the chat Development worker.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
