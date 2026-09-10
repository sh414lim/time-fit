import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const key = randomBytes(32).toString('base64');
const result = spawnSync('vercel', ['env', 'add', 'INTEGRATION_ENCRYPTION_KEY', 'production', '--sensitive', '--force', '--yes'], {
  cwd: process.cwd(), input: `${key}\n`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
});
if (result.status !== 0) { process.stderr.write(result.stderr || result.stdout || 'Vercel environment update failed\n'); process.exit(result.status || 1); }
console.log('A new production integration encryption key was registered without printing its value.');
