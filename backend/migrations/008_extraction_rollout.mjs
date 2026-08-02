/**
 * Migration 008 — roll structured extraction out to every HTML source.
 *
 * The pilot verified against live content: navigation chrome is gone, real
 * epidemiological figures are captured (WHO EMRO MERS went from a raw Mustache
 * template literal to 2637 cases / 965 deaths globally plus a separate Saudi
 * Arabia row), and publication dates are read correctly rather than defaulting
 * to today — which had been surfacing year-old bulletins as current signals.
 *
 * This switches the remaining HTML sources. Their `parser_hint` values
 * (`who_outbreak`, `generic`, `ecdc_cdtr_pdf`, `gtfcc_cholera`) were inherited
 * from the SehaRadar manifest and name Python parsers that do not exist in this
 * codebase — every one of them was silently falling through to the same naive
 * title scraper.
 *
 * Deliberately NOT switched:
 *
 *   - JSON sources (WHO_DONS, WHO_MPX_API) have purpose-built parsers that read
 *     the API's own fields. Those are more accurate than extraction and free.
 *   - RSS sources already yield clean titles, links, and dates from the feed
 *     itself. Whether extraction adds enough field quality to justify running
 *     on every feed update is measured separately.
 *   - Browser sources cannot be fetched at all yet.
 *
 * Usage:  node migrations/008_extraction_rollout.mjs [--apply]
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
    SELECT id, name, parser_hint
    FROM surveillance_sources
    WHERE enabled AND fetch_strategy = 'html' AND parser_hint IS DISTINCT FROM 'ai'
    ORDER BY id
  `;

  console.log(`HTML sources switching to structured extraction: ${targets.length}\n`);
  targets.forEach((t) => console.log(`  ${t.id.padEnd(22)} (was: ${t.parser_hint})`));

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
    // Clear hashes so the next scan re-reads these pages through the new
    // extractor rather than skipping them as unchanged.
    await tx`UPDATE source_snapshots SET content_hash = NULL WHERE source_id IN ${tx(ids)}`;
  });

  const [{ n }] = await sql`
    SELECT count(*)::int AS n FROM surveillance_sources WHERE parser_hint = 'ai' AND enabled`;
  console.log(`\nsources using structured extraction: ${n}`);
  console.log('Migration 008 complete.');
} finally {
  await sql.end();
}
