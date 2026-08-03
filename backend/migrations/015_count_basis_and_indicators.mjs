/**
 * Migration 015 — count basis, reporting period, and epidemiological indicators
 * on radar events.
 *
 * Two defects, one shape: facts the extractor already produced were being
 * thrown away between extraction and scoring.
 *
 * 1. **Counts had no span.** WHO's MERS page reports 2,226 cases in Saudi
 *    Arabia since 2012. Scored against an expected annual total that reads as
 *    11.1x the yearly burden, and the Kingdom's routine surveillance page came
 *    out as a critical event. Fourteen years of cases is not an anomaly.
 *    `count_basis` records what the numbers cover so the magnitude rules can
 *    exclude historical totals rather than discount them by an invented factor.
 *
 * 2. **`indicators` never reached the scorer.** The extractor read ten booleans
 *    off every source — novel pathogen, healthcare-worker infections,
 *    human-to-human transmission, and so on — and the collector carried them in
 *    memory to an insert that had no column for them. Scoring then re-read the
 *    row from the database, so every indicator-driven rule was dead code.
 *
 *    These are the strongest rules in the model: novel pathogen sets
 *    unusualness to 3 on its own, healthcare-worker infection sets spread to 3
 *    as a sentinel for sustained human-to-human transmission. Losing them meant
 *    spread was decided almost entirely by the baseline transmission route, and
 *    novelty — the single best PHEIC predictor — never fired at all.
 *
 * Scores are cleared so everything recomputes against the repaired inputs.
 * Existing rows keep count_basis 'unknown' and null indicators until their
 * source is next extracted, which is honest: we do not know what those numbers
 * covered, and 'unknown' is scored as current so no real signal goes quiet.
 *
 * Also adds `radar_events.updated_at`. Inserts became upserts in this change —
 * sources republish one headline with revised figures, and the previous
 * `ON CONFLICT DO NOTHING` discarded every such update — so an event's facts can
 * now move after it was first scored. `updated_at` is what lets the scoring pass
 * find those events again instead of only ever looking at unscored ones.
 *
 * Usage:  node migrations/015_count_basis_and_indicators.mjs [--apply]
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
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'radar_events'
      AND column_name IN ('count_basis', 'count_period', 'indicators')`;
  const have = new Set(cols.map((r) => r.column_name));
  console.log('radar_events already has:', [...have].join(', ') || 'none of the new columns');

  const [{ events }] = await sql`SELECT count(*)::int AS events FROM radar_events`;
  const [{ scores }] = await sql`SELECT count(*)::int AS scores FROM event_scores`;
  const [{ promoted }] = await sql`
    SELECT count(*)::int AS promoted FROM signals
    WHERE auto_promoted = true AND triage_status = 'Pending Triage'`;

  console.log(`radar events            : ${events}`);
  console.log(`scores to be cleared    : ${scores}`);
  console.log(`auto-promoted, untriaged: ${promoted} (these will be removed and re-derived)`);

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to execute.');
    console.log('After applying, run: npx tsx scripts/backfill-scores.mts --apply');
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    await tx`
      ALTER TABLE radar_events
        ADD COLUMN IF NOT EXISTS count_basis  varchar(24) DEFAULT 'unknown',
        ADD COLUMN IF NOT EXISTS count_period varchar(80),
        ADD COLUMN IF NOT EXISTS indicators   jsonb,
        ADD COLUMN IF NOT EXISTS updated_at   timestamptz DEFAULT now()
    `;
    console.log('altered : radar_events (count_basis, count_period, indicators, updated_at)');

    // Auto-promoted signals nobody has triaged yet were derived from scores
    // computed without indicators. Re-deriving them is safer than leaving a
    // queue whose provenance no longer matches the scorer. Anything an analyst
    // has already accepted or rejected is left alone — that is their decision,
    // not the scorer's.
    //
    // Order matters: radar_events.promoted_signal_id is a foreign key, so the
    // references have to be cleared before the signals they point at go.
    const doomed = await tx`
      SELECT id FROM signals
      WHERE auto_promoted = true AND triage_status = 'Pending Triage'`;
    const ids = doomed.map((r) => r.id);

    if (ids.length) {
      await tx`
        UPDATE radar_events SET is_promoted = false, promoted_signal_id = NULL
        WHERE promoted_signal_id = ANY(${ids})`;
      await tx`DELETE FROM signal_links WHERE to_type = 'signal' AND to_id = ANY(${ids})`;
      await tx`DELETE FROM signals WHERE id = ANY(${ids})`;
    }
    console.log(`reset   : ${ids.length} untriaged auto-promoted signals, their promotion flags and links`);

    await tx`DELETE FROM event_scores`;
    console.log('cleared : event_scores (recompute with backfill-scores)');
  });

  console.log('\nMigration 015 complete.');
  console.log('Next: npx tsx scripts/backfill-scores.mts --apply');
} finally {
  await sql.end();
}
