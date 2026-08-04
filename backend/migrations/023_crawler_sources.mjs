/**
 * Migration 023 — route the JavaScript-rendered sources through crawl4ai.
 *
 * Six sources have been reporting "requires JavaScript rendering" since the
 * registry was built, because a Cloudflare Worker cannot run a browser. They
 * are not broken and never were — the content is there, it just does not exist
 * until a browser executes the page's scripts. With the crawler box up, the
 * 'browser' fetch strategy resolves to a real renderer instead of a diagnostic.
 *
 * `crawlerWaitMs` is per source because the reason each one needs a browser
 * differs. The WHO Mpox dashboard is a Shiny app that fetches its data after
 * first paint, so a short wait returns an empty shell — which is exactly the
 * failure that made Beacon useless through the Jina proxy. RKI and Italy are
 * ordinary server-rendered pages behind a client-side framework and settle fast.
 *
 * Usage:  node migrations/023_crawler_sources.mjs [--apply]
 */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APPLY = process.argv.includes('--apply');

// sourceId -> [waitMs, why]
const CRAWLER_SOURCES = {
  WHO_MPX:       [8000, 'ShinyApps dashboard; data arrives well after first paint'],
  CHINA_CDC:     [5000, 'content injected client-side, slow origin'],
  JAPAN_MHLW:    [4000, 'client-rendered listing'],
  HONG_KONG_CHP: [4000, 'client-rendered listing'],
  GERMANY_RKI:   [3000, 'ASP.NET page behind a client-side framework'],
  ITALY_HEALTH:  [3000, 'client-rendered listing'],
};

function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const devVars = readFileSync(fileURLToPath(new URL('../.dev.vars', import.meta.url)), 'utf8');
  const match = devVars.match(/^DATABASE_URL=(.*)$/m);
  if (!match) throw new Error('DATABASE_URL not found in environment or .dev.vars');
  return match[1].trim().replace(/^"|"$/g, '');
}

const sql = postgres(connectionString(), { ssl: 'require' });

try {
  const ids = Object.keys(CRAWLER_SOURCES);
  const rows = await sql`
    SELECT id, name, fetch_strategy, parser_hint, enabled
    FROM surveillance_sources WHERE id = ANY(${ids}) ORDER BY id`;

  console.log('sources to route through the crawler:');
  for (const r of rows) {
    const [wait, why] = CRAWLER_SOURCES[r.id];
    console.log(`  ${r.id.padEnd(15)} ${String(r.fetch_strategy).padEnd(8)} -> browser, wait ${String(wait).padStart(4)}ms  — ${why}`);
  }
  const missing = ids.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length) console.log(`\nnot in the registry (skipped): ${missing.join(', ')}`);

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to execute.');
    process.exit(0);
  }

  for (const r of rows) {
    const [wait] = CRAWLER_SOURCES[r.id];
    await sql`
      UPDATE surveillance_sources
      SET fetch_strategy = 'browser',
          parser_hint    = 'ai',
          enabled        = true,
          disabled_reason = NULL,
          config = coalesce(config, '{}'::jsonb) || ${sql.json({ crawlerWaitMs: wait })},
          updated_at = now()
      WHERE id = ${r.id}`;
  }
  console.log(`\nrouted  : ${rows.length} sources`);

  // Clear their hashes so the next scan actually re-fetches rather than
  // treating a page it never successfully read as unchanged.
  const cleared = await sql`
    UPDATE source_snapshots SET content_hash = NULL WHERE source_id = ANY(${ids}) RETURNING source_id`;
  console.log(`cleared : ${cleared.length} content hashes`);

  console.log('\nMigration 023 complete.');
  console.log('Set CRAWLER_URL and CRAWLER_TOKEN, then: npx tsx scripts/run-scan.mts --force');
} finally {
  await sql.end();
}
