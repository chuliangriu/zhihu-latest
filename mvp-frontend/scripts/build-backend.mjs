import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const backend = fileURLToPath(new URL('../../mvp-backend/', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
if (!existsSync(new URL('../../mvp-backend/node_modules/typescript', import.meta.url))) {
  execFileSync(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: backend, stdio: 'inherit' });
}
execFileSync(npm, ['run', 'build'], { cwd: backend, stdio: 'inherit' });
const bundle = new URL('../api-backend-dist/', import.meta.url);
rmSync(bundle, { recursive: true, force: true });
cpSync(new URL('../../mvp-backend/dist/', import.meta.url), bundle, { recursive: true });
for (const directory of ['data', 'fixtures']) {
  cpSync(new URL('../../mvp-backend/' + directory + '/', import.meta.url), new URL('../' + directory + '/', import.meta.url), { recursive: true });
}
console.log('Prepared Vercel backend bundle from the current source.');
