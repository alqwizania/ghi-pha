/**
 * Migration 017 — archive pre-repair signals and their assessments.
 *
 * Migration 013 purged the radar events the naive title scraper produced, but
 * the signals promoted from them were left behind, and so were the assessments
 * opened against those signals. The result is a triage queue that is 92% noise
 * — disease "Hand" with country "foot, and mouth disease, Viet Nam", disease
 * "Image 1: Republic of Croatia M" — and a dashboard whose entire assessment
 * line listing descends from it. Every view is technically correct and
 * completely unusable.
 *
 * These records are **archived, not deleted.** A public health authority does
 * not silently drop surveillance records, even bad ones: someone escalated the
 * African swine fever item to a director, and that decision stays on the
 * record. Archiving takes them out of the working queues while leaving every
 * row and its history intact, and it is reversible with a single UPDATE.
 *
 * Scope is deliberately narrow: signals that were never auto-promoted by the
 * scorer. Everything the repaired pipeline produced carries auto_promoted =
 * true, so the boundary is exact and does not depend on guessing a date.
 *
 * Usage:  node migrations/017_archive_legacy_signals.mjs [--apply]
 */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APPLY = process.argv.includes('--apply');

const REASON =
  'Archived by migration 017: legacy record created by the pre-2 Aug 2026 title scraper, ' +
  'superseded by structured extraction. Retained for audit; excluded from the working queues.';

function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const devVars = readFileSync(fileURLToPath(new URL('../.dev.vars', import.meta.url)), 'utf8');
  const match = devVars.match(/^DATABASE_URL=(.*)$/m);
  if (!match) throw new Error('DATABASE_URL not found in environment or .dev.vars');
  return match[1].trim().replace(/^"|"$/g, '');
}

const sql = postgres(connectionString(), { ssl: 'require' });

try {
  const [counts] = await sql`
    SELECT
      count(*) FILTER (WHERE NOT auto_promoted AND current_status <> 'Archived')::int AS legacy,
      count(*) FILTER (WHERE auto_promoted)::int                                      AS kept,
      count(*)::int                                                                   AS total
    FROM signals`;

  const [assessCounts] = await sql`
    SELECT count(*)::int AS n FROM assessments a
    JOIN signals s ON s.id = a.signal_id
    WHERE NOT s.auto_promoted AND a.status <> 'Archived'`;

  console.log(`signals total                : ${counts.total}`);
  console.log(`  to archive (legacy)        : ${counts.legacy}`);
  console.log(`  kept (scorer-promoted)     : ${counts.kept}`);
  console.log(`assessments to archive       : ${assessCounts.n}`);

  const sample = await sql`
    SELECT left(disease, 34) AS disease, left(country, 26) AS country
    FROM signals WHERE NOT auto_promoted AND current_status <> 'Archived'
    ORDER BY created_at DESC LIMIT 5`;
  if (sample.length) {
    console.log('\nsample of what will be archived:');
    for (const r of sample) console.log(`  ${r.disease.padEnd(36)} ${r.country}`);
  }

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to execute.');
    console.log('Reversible with: UPDATE signals SET current_status = \'New\', triage_status = \'Pending Triage\'');
    console.log('                 WHERE rejection_reason LIKE \'Archived by migration 017%\';');
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    const s = await tx`
      UPDATE signals
      SET triage_status    = 'Rejected',
          current_status   = 'Archived',
          rejection_reason = ${REASON},
          updated_at       = now()
      WHERE NOT auto_promoted AND current_status <> 'Archived'
      RETURNING id`;
    console.log(`archived : ${s.length} signals`);

    const a = await tx`
      UPDATE assessments
      SET status = 'Archived', updated_at = now()
      WHERE signal_id IN (SELECT id FROM signals WHERE current_status = 'Archived')
        AND status <> 'Archived'
      RETURNING id`;
    console.log(`archived : ${a.length} assessments`);
  });

  const [after] = await sql`
    SELECT count(*) FILTER (WHERE triage_status = 'Pending Triage')::int AS pending,
           count(*) FILTER (WHERE current_status = 'Archived')::int      AS archived
    FROM signals`;
  console.log(`\ntriage queue now: ${after.pending} pending, ${after.archived} archived.`);
  console.log('Migration 017 complete.');
} finally {
  await sql.end();
}
