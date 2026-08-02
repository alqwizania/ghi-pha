/**
 * Migration 002 — registry-driven ingestion and change detection.
 *
 * Two changes:
 *
 * 1. `surveillance_sources` becomes the single place that decides how a source
 *    is fetched. Previously the fetch logic was hardcoded in the collector and
 *    the table was decorative metadata that nothing read.
 *
 * 2. New `source_snapshots` table holds the last content hash per source. This
 *    is the change detection: fetch, normalize, hash, compare. It replaces the
 *    self-hosted ChangeDetection.io deployment entirely, and doubles as real
 *    per-source health data for the sources drawer.
 *
 * Usage:  node migrations/002_source_registry.mjs [--apply]
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

try {
  const existing = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'surveillance_sources'
  `;
  const have = new Set(existing.map((c) => c.column_name));
  const wanted = ['fetch_strategy', 'parser_hint', 'priority_boost', 'tags', 'config', 'disabled_reason'];
  const missing = wanted.filter((c) => !have.has(c));

  const [{ exists: snapshotsExist }] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'source_snapshots'
    ) AS exists
  `;

  console.log(`surveillance_sources columns to add : ${missing.length ? missing.join(', ') : 'none'}`);
  console.log(`source_snapshots table              : ${snapshotsExist ? 'already exists' : 'will be created'}`);

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to execute.');
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    // How the collector should retrieve this source. 'browser' routes through
    // Cloudflare Browser Rendering for pages that only assemble their content
    // client-side; everything else is a plain fetch plus a parser.
    await tx`
      ALTER TABLE surveillance_sources
        ADD COLUMN IF NOT EXISTS fetch_strategy  varchar(20) NOT NULL DEFAULT 'html',
        ADD COLUMN IF NOT EXISTS parser_hint     varchar(60),
        ADD COLUMN IF NOT EXISTS priority_boost  integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS tags            jsonb   NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS config          jsonb   NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS disabled_reason text
    `;
    console.log('altered  : surveillance_sources');

    await tx`
      CREATE TABLE IF NOT EXISTS source_snapshots (
        source_id             varchar(100) PRIMARY KEY
                                REFERENCES surveillance_sources(id) ON DELETE CASCADE,
        content_hash          text,
        content_bytes         integer,
        last_fetched_at       timestamptz,
        last_success_at       timestamptz,
        last_changed_at       timestamptz,
        last_status           varchar(20)  NOT NULL DEFAULT 'unknown',
        last_error            text,
        consecutive_failures  integer      NOT NULL DEFAULT 0,
        events_last_extracted integer      NOT NULL DEFAULT 0,
        updated_at            timestamptz  NOT NULL DEFAULT now()
      )
    `;
    console.log('created  : source_snapshots');

    // Scans order work by what is most overdue, so this index carries the hot
    // path once the registry grows past a handful of sources.
    await tx`
      CREATE INDEX IF NOT EXISTS source_snapshots_due_idx
      ON source_snapshots (last_fetched_at NULLS FIRST)
    `;
    console.log('created  : source_snapshots_due_idx');
  });

  console.log('\nMigration 002 complete.');
} finally {
  await sql.end();
}
