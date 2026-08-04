/**
 * Migration 027 — actually enable the CDC sources routed through the crawler.
 *
 * Migration 025 set fetch_strategy = 'browser' on CDC_FLUVIEW and
 * CDC_COVID_SURVEILLANCE so they would go through the crawler instead of
 * hitting www.cdc.gov, which answers 403 to Cloudflare Workers egress. It
 * never set enabled = true, so both remained switched off and the repair had
 * no effect: they still appear in the registry as disabled with a reason that
 * no longer applies.
 *
 * Usage:  node migrations/027_enable_crawler_cdc.mjs [--apply]
 */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APPLY = process.argv.includes('--apply');
const IDS = ['CDC_FLUVIEW', 'CDC_COVID_SURVEILLANCE'];

function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const devVars = readFileSync(fileURLToPath(new URL('../.dev.vars', import.meta.url)), 'utf8');
  const m = devVars.match(/^DATABASE_URL=(.*)$/m);
  if (!m) throw new Error('DATABASE_URL not found');
  return m[1].trim().replace(/^"|"$/g, '');
}

const sql = postgres(connectionString(), { ssl: 'require' });

try {
  const rows = await sql`
    SELECT id, enabled, fetch_strategy, left(coalesce(disabled_reason,''), 50) AS reason
    FROM surveillance_sources WHERE id = ANY(${IDS}) ORDER BY id`;
  for (const r of rows) {
    console.log(`  ${r.id.padEnd(24)} enabled=${r.enabled}  strategy=${r.fetch_strategy}  ${r.reason}`);
  }

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply.');
    process.exit(0);
  }

  await sql`
    UPDATE surveillance_sources
    SET enabled = true, disabled_reason = NULL, updated_at = now()
    WHERE id = ANY(${IDS})`;
  await sql`UPDATE source_snapshots SET content_hash = NULL WHERE source_id = ANY(${IDS})`;
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM surveillance_sources WHERE enabled`;
  console.log(`\nenabled ${IDS.length} sources. ${n} sources now enabled.`);
} finally {
  await sql.end();
}
