/**
 * Migration 024 — backfill verification deadlines.
 *
 * `verification_deadline` was declared, rendered in the triage view, and never
 * written. With no value the UI fell through to a hardcoded "24h SLA Active"
 * on every row: a green, reassuring label that measured nothing. That is the
 * same failure as the "SOP Compliance Notice" — a compliance signal asserted
 * rather than observed, and the kind of thing that ends up quoted in a
 * briefing.
 *
 * WHO's event-based surveillance places verification before risk assessment,
 * and PHA's SOP allows 24 hours for it, so the clock starts when a signal
 * reaches triage. Deadlines are set relative to each signal's own creation
 * rather than to now — backdating them to this moment would reset clocks that
 * have in truth been running for days, and the overdue ones are exactly the
 * ones worth seeing.
 *
 * Usage:  node migrations/024_verification_deadlines.mjs [--apply]
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
  const [before] = await sql`
    SELECT count(*)::int AS pending,
           count(verification_deadline)::int AS have_deadline
    FROM signals
    WHERE triage_status = 'Pending Triage' AND current_status <> 'Archived'`;

  console.log(`pending triage        : ${before.pending}`);
  console.log(`already have deadline : ${before.have_deadline}`);
  console.log(`to backfill           : ${before.pending - before.have_deadline}`);

  const overdue = await sql`
    SELECT count(*)::int AS n FROM signals
    WHERE triage_status = 'Pending Triage' AND current_status <> 'Archived'
      AND verification_deadline IS NULL
      AND created_at + interval '24 hours' < now()`;
  console.log(`of which already overdue: ${overdue[0].n}`);

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to execute.');
    process.exit(0);
  }

  const updated = await sql`
    UPDATE signals
    SET verification_deadline = created_at + interval '24 hours',
        updated_at = now()
    WHERE triage_status = 'Pending Triage'
      AND current_status <> 'Archived'
      AND verification_deadline IS NULL
    RETURNING id`;

  console.log(`\nset deadlines on ${updated.length} signals.`);
  console.log('Migration 024 complete. Overdue signals now read as overdue rather than compliant.');
} finally {
  await sql.end();
}
