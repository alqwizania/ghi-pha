/**
 * Migration 009 — structured extraction for RSS sources.
 *
 * RSS already yields clean titles and dates, so this was measured rather than
 * assumed. Three findings, all favouring extraction:
 *
 *   1. Digest posts are split. CIDRAP publishes "Quick takes" items bundling
 *      several unrelated events into one entry. The feed parser recorded that
 *      as a single event with a garbled title, one guessed disease, and zero
 *      counts. Extraction splits it into separate signals — Ebola in DRC with
 *      1,000 deaths, measles in the United States, H9N2 in China. Those are
 *      exactly the signals a surveillance system must not miss inside a digest.
 *
 *   2. Real counts are recovered. The feed parser hardcodes cases and deaths
 *      to 0 because a feed title rarely carries them; extraction reads them
 *      from the item body ("US adds 53 more measles cases" -> 2,371 total).
 *
 *   3. False positives drop sharply. PAHO's feed that day carried four items —
 *      digital-marketing safeguards, diagnostic capacity, HIV elimination
 *      validation, and a conference. The feed parser recorded all four as
 *      surveillance events. Extraction correctly returned none.
 *
 * Cost: RSS extraction runs about $0.14 per feed versus $0.04 for an HTML
 * page, because a feed carries ~20 items and generating one event per item is
 * output-token heavy. Output is the expensive half, and it is also where the
 * value is, so there is no free saving here — see the note in HANDOFF.md.
 *
 * JSON sources are still excluded: WHO_DONS and WHO_MPX_API have purpose-built
 * parsers reading the APIs' own fields, which is more accurate and free.
 *
 * Usage:  node migrations/009_extraction_rss.mjs [--apply]
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
  const targets = await sql`
    SELECT id, name FROM surveillance_sources
    WHERE enabled AND fetch_strategy = 'rss' AND parser_hint IS DISTINCT FROM 'ai'
    ORDER BY id
  `;

  console.log(`RSS sources switching to structured extraction: ${targets.length}\n`);
  targets.forEach((t) => console.log(`  ${t.id}`));

  if (targets.length === 0) {
    console.log('\nNothing to do.');
    process.exit(0);
  }
  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to execute.');
    process.exit(0);
  }

  const ids = targets.map((t) => t.id);
  await sql.begin(async (tx) => {
    await tx`UPDATE surveillance_sources SET parser_hint = 'ai', updated_at = now() WHERE id IN ${tx(ids)}`;
    await tx`UPDATE source_snapshots SET content_hash = NULL WHERE source_id IN ${tx(ids)}`;
  });

  const rows = await sql`
    SELECT parser_hint, count(*)::int AS n FROM surveillance_sources
    WHERE enabled GROUP BY 1 ORDER BY 2 DESC`;
  console.log('\nenabled sources by parser:');
  rows.forEach((r) => console.log(`  ${String(r.parser_hint).padEnd(12)} ${r.n}`));
  console.log('\nMigration 009 complete.');
} finally {
  await sql.end();
}
