/**
 * Migration 025 — route the CDC pages blocked to Workers through the crawler.
 *
 * www.cdc.gov answers 403 to Cloudflare Workers egress. That was worked around
 * for the main CDC source by repointing it at tools.cdc.gov, but two others
 * still hit www.cdc.gov directly and have never once succeeded — their
 * last_success_at is null.
 *
 * The crawler box is not a Cloudflare address, so it reaches these pages
 * normally. Routing them through it costs a browser render they do not
 * strictly need, which is a fair price for a source that has produced nothing
 * since the day it was registered.
 *
 * Usage:  node migrations/025_source_repairs_aug4.mjs [--apply]
 */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APPLY = process.argv.includes('--apply');
const BLOCKED_BY_CDC = ['CDC_COVID_SURVEILLANCE', 'CDC_FLUVIEW'];

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
    SELECT id, name, fetch_strategy, last_success_at IS NULL AS never_worked
    FROM surveillance_sources s
    LEFT JOIN source_snapshots n ON n.source_id = s.id
    WHERE s.id = ANY(${BLOCKED_BY_CDC})`;
  for (const r of rows) {
    console.log(`  ${r.id.padEnd(26)} ${r.fetch_strategy} -> browser` +
      `${r.never_worked ? '   (has never succeeded)' : ''}`);
  }

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply.');
    process.exit(0);
  }

  await sql`
    UPDATE surveillance_sources
    SET fetch_strategy = 'browser', parser_hint = 'ai',
        config = coalesce(config,'{}'::jsonb) || ${sql.json({ crawlerWaitMs: 3000 })},
        updated_at = now()
    WHERE id = ANY(${BLOCKED_BY_CDC})`;
  await sql`UPDATE source_snapshots SET content_hash = NULL WHERE source_id = ANY(${BLOCKED_BY_CDC})`;
  console.log(`\nrouted ${BLOCKED_BY_CDC.length} sources through the crawler.`);
} finally {
  await sql.end();
}
