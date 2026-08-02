/**
 * Migration 001 — deduplicate radar_events and enforce uniqueness.
 *
 * radar_events had no natural unique constraint (its primary key is a random
 * uuid), so `onConflictDoNothing()` could never fire and every scan re-inserted
 * the same headlines. This removes the accumulated duplicates and adds a
 * generated content-hash column with a unique index, so the database itself
 * rejects a repeat insert even when two writers race.
 *
 * The hash expression mirrors the collector's in-process dedupe key
 * (`${sourceId}::${title.trim().toLowerCase()}`) so the two agree exactly.
 *
 * Retention rule within a duplicate group: keep a promoted row if one exists —
 * deleting it would orphan the triage signal that references it — otherwise
 * keep the earliest row.
 *
 * Usage:  node migrations/001_radar_events_unique.mjs [--apply]
 * Without --apply it reports what it would do and changes nothing.
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

const sql = postgres(connectionString(), { ssl: 'require' });

const HASH_EXPR = sql`md5(coalesce(source_id, '') || '::' || lower(btrim(title)))`;

try {
  const [{ n: before }] = await sql`SELECT count(*)::int AS n FROM radar_events`;

  const groups = await sql`
    SELECT ${HASH_EXPR} AS key, count(*)::int AS copies,
           count(*) FILTER (WHERE is_promoted) ::int AS promoted
    FROM radar_events
    GROUP BY 1
    HAVING count(*) > 1
  `;

  const redundant = groups.reduce((sum, g) => sum + (g.copies - 1), 0);
  const wouldLosePromoted = groups.filter((g) => g.promoted > 1);

  console.log(`rows before          : ${before}`);
  console.log(`duplicate groups     : ${groups.length}`);
  console.log(`redundant rows       : ${redundant}`);
  console.log(`groups losing a promoted row: ${wouldLosePromoted.length}`);

  if (wouldLosePromoted.length > 0) {
    console.error('\nAborting: a duplicate group holds more than one promoted event.');
    console.error('Deleting either would orphan a triage signal. Resolve these by hand first.');
    process.exit(1);
  }

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to execute.');
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    const deleted = await tx`
      DELETE FROM radar_events
      WHERE id IN (
        SELECT id FROM (
          SELECT id, row_number() OVER (
            PARTITION BY md5(coalesce(source_id, '') || '::' || lower(btrim(title)))
            ORDER BY is_promoted DESC NULLS LAST, created_at ASC NULLS LAST
          ) AS rn
          FROM radar_events
        ) ranked
        WHERE ranked.rn > 1
      )
      RETURNING id
    `;
    console.log(`\ndeleted duplicates   : ${deleted.length}`);

    await tx`
      ALTER TABLE radar_events
      ADD COLUMN IF NOT EXISTS content_hash text
      GENERATED ALWAYS AS (md5(coalesce(source_id, '') || '::' || lower(btrim(title)))) STORED
    `;
    console.log('added column         : content_hash (generated)');

    await tx`
      CREATE UNIQUE INDEX IF NOT EXISTS radar_events_content_hash_key
      ON radar_events (content_hash)
    `;
    console.log('created index        : radar_events_content_hash_key (unique)');
  });

  const [{ n: after }] = await sql`SELECT count(*)::int AS n FROM radar_events`;
  console.log(`rows after           : ${after}`);
  console.log('\nMigration 001 complete.');
} finally {
  await sql.end();
}
