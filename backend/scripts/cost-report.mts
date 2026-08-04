/**
 * What the last scan cost, per source.
 *
 * Extraction spend was invisible: token usage came back from the API and was
 * dropped on the floor, so the only way to discover it was a billing alert.
 * This reads what migration 018 started recording.
 *
 * Figures are for the most recent pass of each source, so the total is roughly
 * "a full scan where everything changed" — the worst case. Real spend is lower
 * because unchanged sources are never extracted.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/cost-report.mts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

// USD per million tokens, input/output.
const PRICING: Record<string, [number, number]> = {
  'claude-opus-5': [5, 25],
  'claude-sonnet-5': [3, 15],
  'claude-haiku-4-5': [1, 5],
};
const FALLBACK: [number, number] = [1, 5];

function fromDevVars(key: string): string | undefined {
  try {
    const raw = readFileSync(fileURLToPath(new URL('../.dev.vars', import.meta.url)), 'utf8');
    const m = raw.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^"|"$/g, '') : undefined;
  } catch {
    return undefined;
  }
}

const sql = postgres(process.env.DATABASE_URL || fromDevVars('DATABASE_URL')!, { ssl: 'require' });

const cost = (model: string | null, inTok: number, outTok: number) => {
  const [pin, pout] = PRICING[model ?? ''] ?? FALLBACK;
  return (inTok * pin + outTok * pout) / 1_000_000;
};

try {
  const rows = await sql`
    SELECT s.source_id, s.extraction_model, s.input_tokens, s.output_tokens,
           s.items_skipped, s.events_last_extracted, s.last_status, s.last_fetched_at,
           src.name, src.fetch_strategy, coalesce(src.fetch_interval_hours, 6) AS interval_hours
    FROM source_snapshots s
    JOIN surveillance_sources src ON src.id = s.source_id
    WHERE src.enabled
    ORDER BY (coalesce(s.input_tokens,0) * 1 + coalesce(s.output_tokens,0) * 5) DESC`;

  let totalIn = 0, totalOut = 0, totalCost = 0, totalSkipped = 0;

  console.log('source                   model              in tok   out tok   skipped  events     cost');
  console.log('─'.repeat(92));

  for (const r of rows) {
    const inTok = r.input_tokens ?? 0;
    const outTok = r.output_tokens ?? 0;
    if (inTok === 0 && outTok === 0) continue;
    const c = cost(r.extraction_model, inTok, outTok);
    totalIn += inTok; totalOut += outTok; totalCost += c; totalSkipped += r.items_skipped ?? 0;
    console.log(
      `${String(r.source_id).slice(0, 24).padEnd(24)} ${String(r.extraction_model ?? '—').slice(0, 18).padEnd(18)} ` +
      `${String(inTok).padStart(7)} ${String(outTok).padStart(9)} ${String(r.items_skipped ?? 0).padStart(9)} ` +
      `${String(r.events_last_extracted ?? 0).padStart(6)} ${('$' + c.toFixed(4)).padStart(8)}`
    );
  }

  console.log('─'.repeat(92));
  console.log(`${'TOTAL'.padEnd(43)} ${String(totalIn).padStart(7)} ${String(totalOut).padStart(9)} ` +
    `${String(totalSkipped).padStart(9)} ${''.padStart(6)} ${('$' + totalCost.toFixed(4)).padStart(8)}`);

  // Projection uses each source's own interval rather than one global cadence,
  // since a 2-hourly source costs six times what a 12-hourly one does.
  let perDay = 0;
  for (const r of rows) {
    const c = cost(r.extraction_model, r.input_tokens ?? 0, r.output_tokens ?? 0);
    perDay += c * (24 / Number(r.interval_hours));
  }

  console.log(`\nWorst case — every source changes on every scan, at each source's own interval:`);
  console.log(`  ${'$' + perDay.toFixed(2)}/day   ${'$' + (perDay * 30).toFixed(2)}/month`);
  console.log(`\nReal spend is well under this: content hashing skips unchanged sources, and`);
  console.log(`feeds only send entries not already in seen_items (${totalSkipped} skipped last pass).`);

  const [{ n }] = await sql`SELECT count(*)::int AS n FROM seen_items`;
  console.log(`\nseen_items holds ${n} entry identities.`);
} finally {
  await sql.end();
}
