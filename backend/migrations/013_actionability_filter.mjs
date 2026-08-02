/**
 * Migration 013 — separate actionable signals from informational noise.
 *
 * Two changes, both driven by the same complaint: the radar was surfacing
 * items like "Nigerian youths help shape Africa's future health priorities" as
 * surveillance events. Nothing in that requires action from the authority.
 *
 * 1. Purge the legacy naive-extractor rows. They are identifiable by their
 *    generated summary ("Headline detected from ..."), are the bulk of the
 *    noise, and cannot be produced any more — every source that generated them
 *    now uses structured extraction.
 *
 * 2. Record `reports_occurrence` on each score.
 *
 * On why the filter is occurrence and not case counts: 220 of 234 events carry
 * no case or death figure, and among them are "measles outbreak in Delaware",
 * "Ever-expanding US measles outbreak tops last year's total", and an Ebola
 * escalation. The first report of an outbreak almost never carries a count —
 * and early detection is the entire purpose of epidemic intelligence, so
 * filtering on counts would discard exactly the signals worth having.
 *
 * `reportsOccurrence` instead asks whether the item describes a disease
 * actually happening, as opposed to a vaccination campaign, preparedness
 * exercise, funding announcement or conference. That drops the noise while
 * keeping count-free outbreak reports.
 *
 * Usage:  node migrations/013_actionability_filter.mjs [--apply]
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
  const legacy = await sql`
    SELECT id, is_promoted, left(title, 60) AS title FROM radar_events
    WHERE summary LIKE 'Headline detected from%'`;
  const removable = legacy.filter((r) => !r.is_promoted);

  console.log(`legacy naive-extractor rows : ${legacy.length}`);
  console.log(`  removable (not promoted)  : ${removable.length}`);
  console.log(`  promoted, kept for review : ${legacy.length - removable.length}`);
  console.log('\nadds column: event_scores.reports_occurrence');

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to execute.');
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    await tx`
      ALTER TABLE event_scores
      ADD COLUMN IF NOT EXISTS reports_occurrence boolean NOT NULL DEFAULT true
    `;
    await tx`
      CREATE INDEX IF NOT EXISTS event_scores_actionable_idx
      ON event_scores (reports_occurrence, tier)
    `;
    const deleted = await tx`
      DELETE FROM radar_events
      WHERE summary LIKE 'Headline detected from%' AND is_promoted IS NOT TRUE
      RETURNING id`;
    console.log(`\ndeleted legacy rows: ${deleted.length}`);
  });

  // Scores for the deleted events went with them via ON DELETE CASCADE; the
  // rest are rescored by scripts/backfill-scores.mts, which now records the flag.
  await sql`DELETE FROM event_scores`;
  console.log('cleared scores so they are recomputed with the occurrence flag');

  const [{ n }] = await sql`SELECT count(*)::int AS n FROM radar_events`;
  console.log(`remaining events: ${n}`);
  console.log('\nNext: npx tsx scripts/backfill-scores.mts --apply');
  console.log('Migration 013 complete.');
} finally {
  await sql.end();
}
