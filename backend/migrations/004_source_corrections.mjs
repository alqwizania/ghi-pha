/**
 * Migration 004 — corrections from the first full registry scan (2 Aug 2026).
 *
 * The first 42-source scan produced the evidence needed to fix the manifest's
 * stale entries and to identify which sources genuinely need a browser rather
 * than guessing up front:
 *
 *   - Two URLs inherited from the manifest 404. Both agencies moved their
 *     landing pages; the replacements were verified to return 200.
 *
 *   - Six sources are reachable but yield nothing from static HTML. Five return
 *     a page whose content is assembled client-side; one is a Shiny dashboard
 *     that times out entirely. Marking them 'browser' stops them reporting as
 *     mysteriously empty and makes the Browser Rendering work item concrete.
 *
 * Usage:  node migrations/004_source_corrections.mjs [--apply]
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

/** Stale URLs, replaced with paths verified to return 200. */
const URL_FIXES = [
  ['WHO_SEARO', 'https://www.who.int/southeastasia/health-topics/emergencies'],
  ['UK_HPR', 'https://www.gov.uk/government/collections/health-protection-report-latest-infection-reports'],
];

/**
 * Reachable, but static HTML yields no headlines — the content is rendered
 * client-side. These are the Browser Rendering work item, evidenced rather
 * than assumed.
 */
const NEEDS_BROWSER = [
  ['CHINA_CDC', 'Content rendered client-side; static HTML yields no headlines'],
  ['GERMANY_RKI', 'Content rendered client-side; static HTML yields no headlines'],
  ['JAPAN_MHLW', 'Content rendered client-side; static HTML yields no headlines'],
  ['ITALY_HEALTH', 'Content rendered client-side; static HTML yields no headlines'],
  ['HONG_KONG_CHP', 'Content rendered client-side; static HTML yields no headlines'],
  ['WHO_MPX', 'Shiny dashboard; static fetch times out'],
];

const sql = postgres(connectionString(), { ssl: 'require' });

try {
  console.log('URL corrections:');
  for (const [id, url] of URL_FIXES) console.log(`  ${id.padEnd(14)} -> ${url}`);
  console.log('\nRe-strategied to browser rendering:');
  for (const [id, why] of NEEDS_BROWSER) console.log(`  ${id.padEnd(14)} ${why}`);

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to execute.');
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    for (const [id, url] of URL_FIXES) {
      await tx`UPDATE surveillance_sources SET url = ${url}, updated_at = now() WHERE id = ${id}`;
      // The stored hash belongs to the old URL's 404 page; clear it so the next
      // scan treats the corrected page as new content rather than unchanged.
      await tx`UPDATE source_snapshots SET content_hash = NULL WHERE source_id = ${id}`;
    }

    for (const [id, why] of NEEDS_BROWSER) {
      await tx`
        UPDATE surveillance_sources
        SET fetch_strategy = 'browser', disabled_reason = ${why}, updated_at = now()
        WHERE id = ${id}
      `;
    }
  });

  const [{ n: browsers }] = await sql`
    SELECT count(*)::int AS n FROM surveillance_sources WHERE fetch_strategy = 'browser' AND enabled`;
  console.log(`\nsources awaiting Browser Rendering: ${browsers}`);
  console.log('Migration 004 complete.');
} finally {
  await sql.end();
}
