/**
 * Migration 014 — machine-drafted assessments.
 *
 * Adds the frozen half of the assessment record. When a signal is accepted the
 * system writes a full IHR Annex 2 answer set and RRA draft into both the live
 * columns and `machine_draft`; from then on only the live columns move.
 *
 * The point of freezing the draft is precedence without a precedence flag. The
 * analyst's answer is simply the live column, so it always wins by construction,
 * and the difference between the two columns is the override record — you can
 * ask the database "where did a human disagree with the machine, and on what"
 * without any extra bookkeeping.
 *
 * `human_reviewed_at` records that a person opened and saved the assessment at
 * all, which is a different fact from having changed something: an analyst who
 * reads the draft and agrees with it has still done the review.
 *
 * Also widens `ihr_decision` — 'No notification indicated' does not fit the
 * original 50 characters comfortably alongside future wording.
 *
 * Usage:  node migrations/014_machine_assessment.mjs [--apply]
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

const COLUMNS = [
  'machine_draft',
  'machine_drafter_version',
  'machine_scorer_version',
  'machine_generated_at',
  'machine_confidence',
  'human_reviewed_at',
];

try {
  const existing = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'assessments' AND column_name = ANY(${COLUMNS})`;
  const have = new Set(existing.map((r) => r.column_name));
  const missing = COLUMNS.filter((c) => !have.has(c));

  console.log('assessments already has:', [...have].join(', ') || 'none of the new columns');
  console.log('would add             :', missing.join(', ') || 'nothing');

  const [{ count }] = await sql`SELECT count(*)::int AS count FROM assessments`;
  console.log(`existing assessments  : ${count}`);

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to execute.');
    console.log('After applying, run: npx tsx scripts/backfill-assessment-drafts.mts --apply');
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    await tx`
      ALTER TABLE assessments
        ADD COLUMN IF NOT EXISTS machine_draft            jsonb,
        ADD COLUMN IF NOT EXISTS machine_drafter_version  varchar(40),
        ADD COLUMN IF NOT EXISTS machine_scorer_version   varchar(20),
        ADD COLUMN IF NOT EXISTS machine_generated_at     timestamptz,
        ADD COLUMN IF NOT EXISTS machine_confidence       varchar(10),
        ADD COLUMN IF NOT EXISTS human_reviewed_at        timestamptz
    `;
    console.log('altered  : assessments (machine draft columns)');

    await tx`ALTER TABLE assessments ALTER COLUMN ihr_decision TYPE varchar(80)`;
    console.log('altered  : assessments.ihr_decision -> varchar(80)');

    // Finds the assessments still awaiting a draft. Used by the backfill script
    // and worth having as a plain index because the assessment queue filters on
    // it every time the view loads.
    await tx`
      CREATE INDEX IF NOT EXISTS assessments_machine_draft_idx
      ON assessments ((machine_draft IS NULL), created_at DESC)
    `;
    console.log('created  : assessments_machine_draft_idx');
  });

  console.log('\nMigration 014 complete.');
  console.log('Next: npx tsx scripts/backfill-assessment-drafts.mts --apply');
} finally {
  await sql.end();
}
