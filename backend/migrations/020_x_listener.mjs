/**
 * Migration 020 — X listener: cached user ids, spend ledger, redundancy flags.
 *
 * X's pay-per-usage model ($0.005 a post read, $0.010 a user read, no
 * subscription) makes every ingestion decision a spending decision, so the
 * schema has to carry the state that keeps it cheap:
 *
 *   x_user_id       resolved once and kept. User reads cost twice what post
 *                   reads do and a numeric id never changes, so re-resolving
 *                   handles on every poll would cost more than the posts.
 *
 *   last_post_id    the high-water mark. X returns only posts newer than it,
 *                   so a quiet account costs nothing rather than re-billing
 *                   its last ten posts every pass.
 *
 *   redundant_with  the radar source that already carries this account's
 *                   content. Eight of the twelve monitored accounts are
 *                   official agencies whose posts are links to pages GHI
 *                   already collects — and the page usually goes up before
 *                   the tweet. Paying to read @WHO on X is paying for a
 *                   worse copy of something already held.
 *
 * `listener_spend` is the ledger. A surveillance system that quietly drains a
 * prepaid balance is worse than one that stops and says so.
 *
 * Usage:  node migrations/020_x_listener.mjs [--apply]
 */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APPLY = process.argv.includes('--apply');

// Accounts whose content the radar already collects, and from where.
const REDUNDANT = {
  '@WHO': 'WHO_NEWS',
  '@WHOEMRO': 'WHO_EMRO_MERS',
  '@CDCgov': 'CDC',
  '@ProMED_mail': 'PROMED',
  '@SaudiMOH': 'SAUDI_MOH',
  '@KSACDC': 'SAUDI_MOH',
};

function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const devVars = readFileSync(fileURLToPath(new URL('../.dev.vars', import.meta.url)), 'utf8');
  const match = devVars.match(/^DATABASE_URL=(.*)$/m);
  if (!match) throw new Error('DATABASE_URL not found in environment or .dev.vars');
  return match[1].trim().replace(/^"|"$/g, '');
}

const sql = postgres(connectionString(), { ssl: 'require' });

try {
  const accounts = await sql`SELECT account_handle, account_type FROM monitored_accounts ORDER BY account_handle`;
  const redundant = accounts.filter((a) => REDUNDANT[a.account_handle]);
  const unique = accounts.filter((a) => !REDUNDANT[a.account_handle]);

  console.log(`monitored accounts: ${accounts.length}`);
  console.log(`\n${redundant.length} already covered by the radar (will not be polled):`);
  for (const a of redundant) console.log(`  ${a.account_handle.padEnd(16)} -> ${REDUNDANT[a.account_handle]}`);
  console.log(`\n${unique.length} genuinely X-only (worth paying for):`);
  for (const a of unique) console.log(`  ${a.account_handle.padEnd(16)} ${a.account_type}`);

  // Posts per account per day is the cost driver, not poll frequency: X charges
  // once per resource per 24h however often it is requested.
  const est = unique.length * 25 * 30 * 0.005;
  console.log(`\nEstimated: ${unique.length} accounts x ~25 posts/day x 30 days x $0.005 = $${est.toFixed(2)}/month`);
  console.log(`All twelve would be $${(accounts.length * 25 * 30 * 0.005).toFixed(2)}/month for a worse copy of what the radar has.`);

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to execute.');
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    await tx`
      ALTER TABLE monitored_accounts
        ADD COLUMN IF NOT EXISTS x_user_id      varchar(32),
        ADD COLUMN IF NOT EXISTS last_post_id   varchar(32),
        ADD COLUMN IF NOT EXISTS redundant_with varchar(100),
        ADD COLUMN IF NOT EXISTS last_polled_at timestamptz,
        ADD COLUMN IF NOT EXISTS posts_read     integer DEFAULT 0 NOT NULL
    `;
    console.log('altered : monitored_accounts');

    for (const [handle, sourceId] of Object.entries(REDUNDANT)) {
      await tx`
        UPDATE monitored_accounts
        SET redundant_with = ${sourceId}, is_active = false, updated_at = now()
        WHERE account_handle = ${handle}`;
    }
    console.log(`flagged : ${Object.keys(REDUNDANT).length} redundant accounts, deactivated`);

    await tx`
      CREATE TABLE IF NOT EXISTS listener_spend (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        polled_at   timestamptz NOT NULL DEFAULT now(),
        platform    varchar(20) NOT NULL DEFAULT 'x',
        post_reads  integer     NOT NULL DEFAULT 0,
        user_reads  integer     NOT NULL DEFAULT 0,
        cost_usd    numeric(10,4) NOT NULL DEFAULT 0,
        accounts    integer     NOT NULL DEFAULT 0,
        detail      text
      )
    `;
    await tx`CREATE INDEX IF NOT EXISTS listener_spend_time ON listener_spend (polled_at DESC)`;
    console.log('created : listener_spend');
  });

  console.log('\nMigration 020 complete.');
  console.log('Set the token with: npx wrangler secret put X_BEARER_TOKEN  (and add it to .dev.vars locally)');
} finally {
  await sql.end();
}
