import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
mkdirSync(path.join(root, 'public/assets'), { recursive: true });
await build({
  absWorkingDir: root, entryPoints: ['src/admin/ui.jsx'], bundle: true, minify: true,
  format: 'esm', target: ['es2022'], outfile: 'public/assets/admin-ui.js',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: { '@': path.join(root, 'src/admin') }, legalComments: 'linked',
});
execFileSync(process.execPath, [path.join(root, 'node_modules/@tailwindcss/cli/dist/index.mjs'),
  '-i', 'src/admin/styles.css', '-o', 'public/assets/admin-ui.css', '--minify'], { cwd: root, stdio: 'inherit' });
console.log('Built admin shadcn components and theme.');
