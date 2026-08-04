/**
 * Runs one listener poll from Node.
 *
 * Same reason as run-scan.mts: this spends real money against a prepaid X
 * balance, so it should be runnable and observable from a terminal rather than
 * only firing on a cron nobody watches.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/run-listener.mts                 # $2 budget cap
 *   npx tsx scripts/run-listener.mts --budget 0.50   # tighter cap
 *   npx tsx scripts/run-listener.mts --dry           # what it would cost, no calls
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema.js';
import { pollListener } from '../src/services/listener-poller.js';
import { POST_READ_COST, USER_READ_COST } from '../src/services/x-listener.js';

const argv = process.argv;
const DRY = argv.includes('--dry');
const budgetArg = argv.indexOf('--budget');
const BUDGET = budgetArg > -1 ? Number(argv[budgetArg + 1]) : 2.0;

function fromDevVars(key: string): string | undefined {
  try {
    const raw = readFileSync(fileURLToPath(new URL('../.dev.vars', import.meta.url)), 'utf8');
    const m = raw.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^"|"$/g, '') : undefined;
  } catch {
    return undefined;
  }
}

const client = postgres(process.env.DATABASE_URL || fromDevVars('DATABASE_URL')!, { ssl: 'require', max: 4 });
const db = drizzle(client, { schema });
const token = process.env.X_BEARER_TOKEN || fromDevVars('X_BEARER_TOKEN');

try {
  if (DRY) {
    const accounts = await client`SELECT account_handle, account_type, priority, x_user_id, last_post_id FROM monitored_accounts WHERE is_active ORDER BY priority, account_handle`;
    const [{ n: keywords }] = await client`SELECT count(*)::int AS n FROM listener_keywords WHERE is_active`;
    const unresolved = accounts.filter((a: any) => !a.x_user_id).length;

    console.log(`active accounts   : ${accounts.length}`);
    console.log(`active keywords   : ${keywords}`);
    console.log(`needing id lookup : ${unresolved}  ($${(unresolved * USER_READ_COST).toFixed(3)}, one time)`);
    console.log(`\nper poll, worst case at 20 posts each:`);
    console.log(`  ${accounts.length} x 20 x $${POST_READ_COST} = $${(accounts.length * 20 * POST_READ_COST).toFixed(2)}`);
    console.log(`\nReal cost is far lower: since_id means quiet accounts return nothing,`);
    console.log(`and X bills once per post per 24h however often it is polled.`);
    console.log(`\nAccounts:`);
    for (const a of accounts) {
      console.log(`  ${String(a.account_handle).padEnd(16)} ${String(a.account_type).padEnd(11)} p${a.priority}` +
        `  ${a.x_user_id ? 'id cached' : 'needs lookup'}${a.last_post_id ? ', has high-water mark' : ''}`);
    }
    process.exit(0);
  }

  if (!token) {
    console.error('X_BEARER_TOKEN not found in environment or .dev.vars');
    process.exit(1);
  }

  const started = Date.now();
  const result = await pollListener(db, { X_BEARER_TOKEN: token }, { budgetUsd: BUDGET });
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\npoll finished in ${secs}s — status ${result.status}`);
  console.log(`accounts polled : ${result.accountsPolled}`);
  console.log(`posts read      : ${result.postsRead}`);
  console.log(`signals stored  : ${result.signalsStored}`);
  console.log(`cost            : $${result.costUsd.toFixed(4)}`);

  console.log('\nper account:');
  for (const [k, v] of Object.entries(result.diagnostics)) {
    console.log(`  ${k.padEnd(16)} ${v}`);
  }

  const spend = await client`
    SELECT count(*)::int AS polls, sum(post_reads)::int AS posts, sum(cost_usd)::numeric AS total
    FROM listener_spend WHERE polled_at > now() - interval '30 days'`;
  const s = spend[0];
  console.log(`\nlast 30 days: ${s.polls} polls, ${s.posts ?? 0} posts read, $${Number(s.total ?? 0).toFixed(2)}`);
} finally {
  await client.end();
}
