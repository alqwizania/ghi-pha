/**
 * Pushes the Worker's secrets to Cloudflare, reading them from .dev.vars.
 *
 * The manual route is six `wrangler secret put` calls, each requiring the right
 * value pasted at a prompt. That is tedious and easy to get subtly wrong — a
 * trailing space or an included `KEY=` prefix produces a secret that looks set
 * and fails at runtime, which is worse than one that is obviously missing.
 *
 * Values are piped straight from the file into wrangler's stdin. Nothing is
 * printed, nothing lands in shell history, and the script never holds a value
 * longer than the call it is making. What you see is the name and whether it
 * succeeded.
 *
 * JWT_SECRET is generated fresh rather than copied. If production and a laptop
 * share a signing secret, a token minted locally is valid against the live
 * system — so the local one is deliberately not reused.
 *
 * Usage:
 *   cd backend
 *   node scripts/set-secrets.mjs          # show what would be set
 *   node scripts/set-secrets.mjs --apply  # set them
 *
 * Requires CLOUDFLARE_API_TOKEN in the environment.
 */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');

// Secrets read from .dev.vars, plus the ones that are generated or fixed.
const FROM_FILE = ['DATABASE_URL', 'ANTHROPIC_API_KEY', 'X_BEARER_TOKEN', 'CRAWLER_URL', 'CRAWLER_TOKEN'];

function readDevVars() {
  let raw;
  try {
    raw = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
  } catch {
    console.error('Could not read backend/.dev.vars — run this from the backend directory.');
    process.exit(1);
  }
  const vars = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) vars[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
  return vars;
}

const vars = readDevVars();

// A fresh signing secret for production. 48 bytes of base64url is well beyond
// what HS256 needs and avoids any character that would need escaping.
const jwtSecret = randomBytes(48).toString('base64url');

const plan = [
  ...FROM_FILE.map((name) => ({ name, value: vars[name], origin: '.dev.vars' })),
  { name: 'JWT_SECRET', value: jwtSecret, origin: 'generated fresh' },
];

console.log('Secrets for the ghi-core Worker:\n');
for (const s of plan) {
  const state = s.value ? `${String(s.value.length).padStart(4)} chars` : '   MISSING';
  console.log(`  ${s.name.padEnd(20)} ${state}   (${s.origin})`);
}

const missing = plan.filter((s) => !s.value);
if (missing.length) {
  console.error(`\n${missing.length} value(s) not found in .dev.vars: ${missing.map((m) => m.name).join(', ')}`);
  console.error('Add them there first, or set those by hand with: npx.cmd wrangler secret put <NAME>');
}

if (!process.env.CLOUDFLARE_API_TOKEN) {
  console.error('\nCLOUDFLARE_API_TOKEN is not set in this shell. In PowerShell:');
  console.error('  $env:CLOUDFLARE_API_TOKEN = \'your-token\'');
  process.exit(1);
}

if (!APPLY) {
  console.log('\nDry run — nothing sent. Re-run with --apply to set them.');
  console.log('Note: JWT_SECRET is regenerated on each run, so apply once and keep it.');
  process.exit(0);
}

console.log('');
let ok = 0;
for (const s of plan) {
  if (!s.value) continue;
  // Value goes to wrangler's stdin, never to argv — argv is visible in the
  // process list to anything else running on the machine.
  // shell:true is required on Windows: Node refuses to spawn .cmd or .bat
  // directly since the CVE-2024-27980 fix, and fails with no stderr at all —
  // which is why the first version of this reported six blank failures.
  const res = spawnSync(
    'npx',
    ['wrangler', 'secret', 'put', s.name],
    {
      input: s.value,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    }
  );

  if (res.status === 0) {
    console.log(`  set     ${s.name}`);
    ok++;
  } else {
    // Report the spawn error too. A failure with empty stderr means the process
    // never started, which is a completely different problem from wrangler
    // rejecting the value, and saying "FAILED" for both hides that.
    const why = res.error
      ? `could not run wrangler: ${res.error.message}`
      : ((res.stderr || res.stdout || '').trim().split('\n').filter(Boolean).slice(-2).join(' ') || `exit code ${res.status}`);
    console.log(`  FAILED  ${s.name}: ${why}`);
  }
}

console.log(`\n${ok} of ${plan.filter((s) => s.value).length} secrets set.`);
if (ok > 0) {
  console.log('Rotating JWT_SECRET invalidates existing sessions — everyone logs in again. That is intended.');
  console.log('\nVerify with: npx.cmd wrangler secret list');
}
