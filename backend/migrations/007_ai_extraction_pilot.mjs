/**
 * Migration 007 — enable structured extraction on four pilot sources.
 *
 * The naive title scraper cannot distinguish an outbreak headline from page
 * furniture. Measured against ECDC's threats page, five of the eight "events"
 * it recorded were navigation chrome: "Main Navigation (desktop)", "Global
 * Navigation", "Public health topics", "Publications and data", "Emerging
 * threats". Those became rows in radar_events and, from there, candidate
 * triage signals.
 *
 * These four sources switch to `parser_hint = 'ai'`, which routes their
 * content through Claude with a fixed extraction schema. Facts come from the
 * model; risk classification stays in deterministic code, so an escalation can
 * still be explained without appealing to model judgement.
 *
 * Deliberately four and not forty: extraction quality has to be measured
 * against what an analyst would have recorded before it is trusted across the
 * whole registry. The remaining sources keep the legacy extractor until then.
 *
 * Without ANTHROPIC_API_KEY set, these sources fall back to the legacy
 * extractor rather than failing.
 *
 * Usage:  node migrations/007_ai_extraction_pilot.mjs [--apply]
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

/** Enabled HTML sources whose pages defeat the title scraper. */
const PILOT = ['ECDC', 'WHO_AFRO', 'UK_UKHSA', 'WHO_EMRO_MERS'];

const sql = postgres(connectionString(), { ssl: 'require' });

try {
  const rows = await sql`
    SELECT id, name, enabled, fetch_strategy, parser_hint
    FROM surveillance_sources WHERE id IN ${sql(PILOT)} ORDER BY id`;

  console.log('pilot sources:');
  rows.forEach((r) =>
    console.log(`  ${r.id.padEnd(16)} enabled=${r.enabled} strategy=${r.fetch_strategy} parser=${r.parser_hint} -> ai`)
  );

  const missing = PILOT.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length) console.log(`\n  not found in registry: ${missing.join(', ')}`);

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to execute.');
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    await tx`
      UPDATE surveillance_sources
      SET parser_hint = 'ai', updated_at = now()
      WHERE id IN ${tx(PILOT)}
    `;
    // Clear the hashes so the next scan re-reads these pages through the new
    // extractor instead of skipping them as unchanged.
    await tx`UPDATE source_snapshots SET content_hash = NULL WHERE source_id IN ${tx(PILOT)}`;
  });

  const [{ n }] = await sql`
    SELECT count(*)::int AS n FROM surveillance_sources WHERE parser_hint = 'ai' AND enabled`;
  console.log(`\nsources using structured extraction: ${n}`);
  console.log('Migration 007 complete.');
} finally {
  await sql.end();
}
