import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// The CLI loads .env.local and the Development environment's variables itself.
// Optional local provider overrides belong in the ignored .env.development.local.
const cli=fileURLToPath(import.meta.resolve('trigger.dev'));
const child=spawn(process.execPath,[cli,'dev','--branch','codex/sanity-content-setup','--skip-update-check'],{
  stdio:'inherit',env:{...process.env,KV_NAMESPACE:'sanity-preview'},
});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
