import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [sourceFile, targetDirectory] = process.argv.slice(2);
if (!sourceFile || !targetDirectory) {
  throw new Error('Usage: node scripts/transfer-tossplace-vercel-env.mjs <source-env-file> <timefit-directory>');
}

function parseEnv(source) {
  return Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return [];
    const index = trimmed.indexOf('=');
    if (index < 1) return [];
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [[key, value]];
  }));
}

const source = parseEnv(readFileSync(resolve(sourceFile), 'utf8'));
const keys = ['TOSSPLACE_MERCHANT_ID', 'TOSSPLACE_ACCESS_KEY', 'TOSSPLACE_ACCESS_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missing = keys.filter(key => !source[key]);
if (missing.length) throw new Error(`Source Vercel environment is missing: ${missing.join(', ')}`);

function setProductionSecret(name, value) {
  execFileSync('vercel', ['env', 'add', name, 'production', '--value', value, '--sensitive', '--force', '--yes'], {
    cwd: resolve(targetDirectory), stdio: 'inherit',
  });
}

for (const key of keys) setProductionSecret(key, source[key]);
setProductionSecret('CRON_SECRET', crypto.getRandomValues(new Uint8Array(32)).reduce((out, byte) => out + byte.toString(16).padStart(2, '0'), ''));
console.log('Toss Place server secrets and a new Cron secret were registered in TimeFit Production.');
