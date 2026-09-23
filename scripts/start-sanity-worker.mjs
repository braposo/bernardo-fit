import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// The CLI loads .env.local and the Development environment's variables itself.
// Optional local provider overrides belong in the ignored .env.development.local.
const cli=fileURLToPath(import.meta.resolve('trigger.dev'));
const branch=process.argv[2] || 'codex/sanity-content-setup';
const namespace=process.argv[3] || 'sanity-preview';
if(!/^[a-zA-Z0-9_-]{1,80}$/.test(namespace))throw new Error('Invalid worker namespace');
const child=spawn(process.execPath,[cli,'dev','--branch',branch,'--skip-update-check'],{
  stdio:'inherit',env:{...process.env,KV_NAMESPACE:namespace},
});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
