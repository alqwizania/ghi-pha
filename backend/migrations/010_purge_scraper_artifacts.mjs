/**
 * Migration 010 — remove page furniture recorded as surveillance events.
 *
 * Before structured extraction, the title scraper could not distinguish an
 * outbreak headline from site navigation. Rows like "Main Navigation
 * (desktop)", "Global Navigation" and "Publications and data" were written to
 * radar_events and were candidates for promotion into the triage queue.
 *
 * This removes them. Promoted rows are never deleted — a promoted event is
 * referenced by a triage signal, and an analyst has already looked at it, so
 * it is reported for manual review instead.
 *
 * Usage:  node migrations/010_purge_scraper_artifacts.mjs [--apply]
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

/**
 * Navigation and site-chrome phrases. Anchored to whole titles or clear
 * navigation wording rather than loose keyword matching, so a real outbreak
 * report that happens to mention "publications" is not caught.
 */
const JUNK_PATTERN =
  '(^|\\s)(main navigation|global navigation|skip to (main )?content|' +
  'publications and data|public health topics|emerging threats|learning portal|' +
  'related content|access our data|understanding the data|what.s new|' +
  'cookie|newsletter|privacy (notice|policy)|terms of use|site ?map)($|\\s)';

const sql = postgres(connectionString(), { ssl: 'require' });

try {
  const candidates = await sql`
    SELECT id, source_id, is_promoted, left(title, 62) AS title
    FROM radar_events WHERE title ~* ${JUNK_PATTERN}
    ORDER BY is_promoted DESC, source_id
  `;

  const promoted = candidates.filter((c) => c.is_promoted);
  const removable = candidates.filter((c) => !c.is_promoted);

  console.log(`matched scraper artifacts: ${candidates.length}`);
  console.log(`  removable (not promoted): ${removable.length}`);
  console.log(`  promoted, left in place : ${promoted.length}`);

  console.log('\nto remove:');
  removable.forEach((c) => console.log(`  ${c.source_id.padEnd(22)} ${c.title}`));
  if (promoted.length) {
    console.log('\nleft in place — already promoted into triage, review by hand:');
    promoted.forEach((c) => console.log(`  ${c.source_id.padEnd(22)} ${c.title}`));
  }

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to execute.');
    process.exit(0);
  }

  const deleted = await sql`
    DELETE FROM radar_events WHERE title ~* ${JUNK_PATTERN} AND is_promoted IS NOT TRUE RETURNING id`;

  const [{ n }] = await sql`SELECT count(*)::int AS n FROM radar_events`;
  console.log(`\ndeleted: ${deleted.length}`);
  console.log(`remaining events: ${n}`);
  console.log('Migration 010 complete.');
} finally {
  await sql.end();
}
