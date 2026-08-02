/**
 * Migration 006 — correct the Beacon Bio registry entry.
 *
 * Migration 003 swept Beacon up with the legacy entries and labelled it
 * "superseded by the merged source registry". That is wrong on two counts:
 * nothing superseded it, and it is not a minor source — 148 of the 150 signals
 * in the triage queue originated from Beacon.
 *
 * What is actually true, established by probing it directly:
 *
 *   - The registered URL (beacon.bio/api/feed) was wrong. That domain belongs
 *     to an unrelated company and 404s. The real site is beaconbio.org.
 *   - beaconbio.org serves an 80KB shell whose Next.js payload carries only UI
 *     translation strings; the event list is fetched client-side after
 *     hydration, so there is nothing to extract from the static HTML.
 *   - Its /api/* and /rss.xml paths return 403 to plain requests.
 *   - The previous Jina-proxy workaround returned the same shell, which is why
 *     the old collector matched zero events on every run.
 *
 * Beacon is therefore the highest-value Browser Rendering candidate: enabling
 * it restores what has historically been the primary feed into triage.
 *
 * Usage:  node migrations/006_beacon_correction.mjs [--apply]
 */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');

function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const devVars = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
  const match = devVars.match(/^DATABASE_URL=(.*)$/m);
  if (!match) throw new Error('DATABASE_URL not found in environment or .dev.vars');
  return match[1].trim().replace(/^"|"$/g, '');
}

const REASON =
  'Event list is rendered client-side and the API returns 403 to plain requests; needs Browser Rendering. ' +
  'Historically the primary feed into triage (148 of 150 signals), so this is the highest-value source to restore.';

const sql = postgres(connectionString(), { ssl: 'require' });

try {
  const [before] = await sql`
    SELECT url, enabled, fetch_strategy, disabled_reason FROM surveillance_sources WHERE id = 'BEACON'`;
  console.log('before:', JSON.stringify(before, null, 2));
  console.log('\nafter : url -> https://beaconbio.org/en/, strategy -> browser, priority_boost -> 3');
  console.log('reason:', REASON);

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to execute.');
    process.exit(0);
  }

  await sql`
    UPDATE surveillance_sources
    SET url = 'https://beaconbio.org/en/',
        name = 'Beacon Bio Epidemiological Intelligence',
        fetch_strategy = 'browser',
        parser_hint = 'html_titles',
        priority_boost = 3,
        fetch_interval_hours = 3,
        enabled = false,
        disabled_reason = ${REASON},
        updated_at = now()
    WHERE id = 'BEACON'
  `;
  await sql`UPDATE source_snapshots SET content_hash = NULL WHERE source_id = 'BEACON'`;

  const [{ n }] = await sql`
    SELECT count(*)::int AS n FROM surveillance_sources WHERE fetch_strategy = 'browser'`;
  console.log(`\nsources awaiting Browser Rendering: ${n}`);
  console.log('Migration 006 complete.');
} finally {
  await sql.end();
}
