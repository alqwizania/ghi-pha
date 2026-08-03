/**
 * Runs a full radar scan from Node instead of through the Worker.
 *
 * A forced scan of all 40 collecting sources takes several minutes in one
 * request, which is longer than `wrangler dev` will hold a connection open —
 * Miniflare restarts the worker mid-request and the scan is lost. That is a
 * local-development limit, not a production one, but it makes the scan
 * impossible to exercise end to end from a terminal.
 *
 * This drives the same `fetchGlobalRadarScan` against the same database with a
 * plain postgres client, so what runs here is the code that runs in production.
 * It is also the right tool for a one-off re-extraction after a schema change.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/run-scan.mts              # only sources whose content moved
 *   npx tsx scripts/run-scan.mts --force      # ignore hashes, re-extract everything
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema.js';
import { fetchGlobalRadarScan } from '../src/services/radar-collector.js';

const FORCE = process.argv.includes('--force');

function fromDevVars(key: string): string | undefined {
  try {
    const raw = readFileSync(fileURLToPath(new URL('../.dev.vars', import.meta.url)), 'utf8');
    const m = raw.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^"|"$/g, '') : undefined;
  } catch {
    return undefined;
  }
}

const connStr = process.env.DATABASE_URL || fromDevVars('DATABASE_URL')!;
const apiKey = process.env.ANTHROPIC_API_KEY || fromDevVars('ANTHROPIC_API_KEY');

if (!apiKey) {
  console.warn('! ANTHROPIC_API_KEY not found — extraction will fall back to the title scraper.');
}

const client = postgres(connStr, { ssl: 'require', max: 4 });
const db = drizzle(client, { schema });

const started = Date.now();
try {
  const result: any = await fetchGlobalRadarScan(db, { ANTHROPIC_API_KEY: apiKey }, { force: FORCE });

  const secs = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`\nscan finished in ${secs}s — status ${result.status}`);
  console.log(`checked ${result.checked}, unchanged ${result.unchanged}, ` +
    `events ${result.count}, inserted/updated ${result.inserted}, dupes ${result.skippedDuplicates}`);

  const yielding = Object.entries(result.sources as Record<string, number>)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  console.log(`\n${yielding.length} source(s) yielded events:`);
  for (const [id, n] of yielding) console.log(`  ${String(n).padStart(4)}  ${id}`);

  if (result.degraded?.length) {
    console.log(`\n${result.degraded.length} degraded source(s):`);
    for (const id of result.degraded) console.log(`  ${id}: ${result.diagnostics[id]}`);
  }

  if (result.scoring) console.log('\nscoring:', result.scoring);
} finally {
  await client.end();
}
