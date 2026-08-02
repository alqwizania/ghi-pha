/**
 * Migration 005 — route around CDC's block on Cloudflare egress.
 *
 * Three CDC sources returned HTTP 403 to the Worker while the identical
 * requests succeeded from other networks, with and without a browser
 * User-Agent, and with requests serialized per host. The block is on
 * `www.cdc.gov` and applies to traffic originating from Cloudflare, so neither
 * politeness nor Browser Rendering would fix it — both share that egress.
 *
 * `tools.cdc.gov` is unaffected: CDC_TRAVEL has been fetching from it
 * throughout. CDC publishes a newsroom feed there, so the outbreaks page is
 * replaced with the feed rather than scraped.
 *
 * The two remaining www.cdc.gov sources have no equivalent feed and are
 * disabled with the real reason recorded, so they stop reporting as failures
 * on every scan.
 *
 * Usage:  node migrations/005_cdc_egress_workaround.mjs [--apply]
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

const BLOCKED_REASON =
  'www.cdc.gov returns HTTP 403 to Cloudflare Workers egress; no equivalent feed exists on tools.cdc.gov';

const sql = postgres(connectionString(), { ssl: 'require' });

try {
  console.log('CDC            -> tools.cdc.gov newsroom RSS (rss strategy)');
  console.log('CDC_FLUVIEW    -> disabled:', BLOCKED_REASON);
  console.log('CDC_COVID_SURVEILLANCE -> disabled:', BLOCKED_REASON);

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to execute.');
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    await tx`
      UPDATE surveillance_sources
      SET url = 'https://tools.cdc.gov/api/v2/resources/media/132608.rss',
          fetch_strategy = 'rss',
          parser_hint = 'rss',
          name = 'CDC Newsroom & Outbreak Releases',
          disabled_reason = NULL,
          enabled = true,
          updated_at = now()
      WHERE id = 'CDC'
    `;
    await tx`UPDATE source_snapshots SET content_hash = NULL WHERE source_id = 'CDC'`;

    await tx`
      UPDATE surveillance_sources
      SET enabled = false, disabled_reason = ${BLOCKED_REASON}, updated_at = now()
      WHERE id IN ('CDC_FLUVIEW', 'CDC_COVID_SURVEILLANCE')
    `;
  });

  const [{ n: active }] = await sql`SELECT count(*)::int AS n FROM surveillance_sources WHERE enabled`;
  console.log(`\nenabled sources: ${active}`);
  console.log('Migration 005 complete.');
} finally {
  await sql.end();
}
