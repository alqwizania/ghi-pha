/**
 * Migration 022 — remove the last mock data.
 *
 * Eight rows in social_signals with post_id 'mock_1'…'mock_8', written by the
 * simulated listener that predated real X ingestion. They were plausible —
 * Arabic MOH-style posts about H5N1 in the Eastern Province — which is exactly
 * the problem: nothing on screen distinguished them from the 51 real posts now
 * arriving, so a fabricated outbreak in the Kingdom sat in the same list as
 * genuine ProMED and WHO reports.
 *
 * The service that generated them (src/services/twitter-listener.ts) is deleted
 * in the same change. It was imported nowhere and had been dead since the real
 * poller landed.
 *
 * Usage:  node migrations/022_purge_mock_data.mjs [--apply]
 */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APPLY = process.argv.includes('--apply');

function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const devVars = readFileSync(fileURLToPath(new URL('../.dev.vars', import.meta.url)), 'utf8');
  const match = devVars.match(/^DATABASE_URL=(.*)$/m);
  if (!match) throw new Error('DATABASE_URL not found in environment or .dev.vars');
  return match[1].trim().replace(/^"|"$/g, '');
}

const sql = postgres(connectionString(), { ssl: 'require' });

try {
  const mocks = await sql`
    SELECT post_id, author_handle, left(content, 60) AS preview
    FROM social_signals
    WHERE post_id LIKE 'mock%' OR platform = 'twitter'
    ORDER BY post_id`;

  console.log(`mock social signals: ${mocks.length}`);
  for (const m of mocks) console.log(`  ${m.post_id.padEnd(8)} ${m.author_handle.padEnd(14)} ${m.preview.replace(/\n/g, ' ')}`);

  const [{ n: real }] = await sql`SELECT count(*)::int AS n FROM social_signals WHERE platform = 'x'`;
  console.log(`\nreal X signals kept: ${real}`);

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to execute.');
    process.exit(0);
  }

  // A mock signal promoted into triage would leave a real assessment behind, so
  // check rather than assume. None are expected; loudly refuse if any exist.
  const promoted = await sql`
    SELECT post_id FROM social_signals
    WHERE (post_id LIKE 'mock%' OR platform = 'twitter') AND related_signal_id IS NOT NULL`;
  if (promoted.length) {
    console.error(`REFUSING: ${promoted.length} mock signals were promoted into triage and have downstream records.`);
    console.error('Resolve those by hand before purging:', promoted.map((p) => p.post_id).join(', '));
    process.exit(1);
  }

  const deleted = await sql`
    DELETE FROM social_signals
    WHERE post_id LIKE 'mock%' OR platform = 'twitter'
    RETURNING post_id`;
  console.log(`deleted : ${deleted.length} mock signals`);
  console.log('\nMigration 022 complete. All listener data is now live X ingestion.');
} finally {
  await sql.end();
}
