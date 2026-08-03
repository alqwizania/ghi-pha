/**
 * Migration 016 — per-source retrospective windows.
 *
 * The radar ignored anything older than a global 14 days. That number has to be
 * short for the picture to stay current, but a single global value then
 * silently excludes every source that publishes less often than the window.
 *
 * WHO EMRO issues its MERS update once a month. By the time anyone looked, the
 * June update was 34 days old, so it was dropped before insert — and the source
 * reported itself as `empty`, which reads as "no outbreaks" rather than "your
 * window is shorter than my publication cycle". The single most relevant source
 * for a Saudi health authority could never land an event, and nothing in the
 * diagnostics said so.
 *
 * Windows below are set from each source's actual publication cadence, at
 * roughly three intervals so a missed cycle does not create a gap:
 *
 *   monthly reports        -> 120 days
 *   quarterly / periodic   -> 200 days
 *
 * Sources not listed keep the 14-day default, which suits anything publishing
 * daily or weekly.
 *
 * Usage:  node migrations/016_retrospective_windows.mjs [--apply]
 */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APPLY = process.argv.includes('--apply');

// sourceId -> retrospective window in days, with the cadence that justifies it.
const WINDOWS = {
  WHO_EMRO_MERS: [120, 'monthly MERS situation update'],
  WHO_MPX_API: [120, 'monthly multi-country mpox situation report'],
  WHO_SITREP: [120, 'monthly situation reports'],
  WHO_COVID_SITREP: [120, 'monthly COVID-19 epidemiological update'],
  WHO_VARIANTS: [120, 'periodic variant risk evaluations'],
  ECDC_CDTR: [60, 'weekly communicable disease threats report, often catching up'],
  GTFCC_CHOLERA: [120, 'monthly global cholera situation report'],
  GPEI_POLIO: [60, 'weekly, but country tables lag'],
  CDC_TRAVEL: [200, 'travel health notices persist for months while in force'],
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
  const ids = Object.keys(WINDOWS);
  const present = await sql`SELECT id FROM surveillance_sources WHERE id = ANY(${ids})`;
  const have = new Set(present.map((r) => r.id));

  console.log('windows to set:');
  for (const [id, [days, why]] of Object.entries(WINDOWS)) {
    console.log(`  ${have.has(id) ? ' ' : '?'} ${id.padEnd(18)} ${String(days).padStart(3)}d  — ${why}`);
  }
  const missing = ids.filter((id) => !have.has(id));
  if (missing.length) console.log(`\n? not in the registry (skipped): ${missing.join(', ')}`);

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to execute.');
    process.exit(0);
  }

  let updated = 0;
  for (const [id, [days]] of Object.entries(WINDOWS)) {
    if (!have.has(id)) continue;
    await sql`
      UPDATE surveillance_sources
      SET config = coalesce(config, '{}'::jsonb) || ${sql.json({ retroWindowDays: days })},
          updated_at = now()
      WHERE id = ${id}`;
    updated++;
  }
  console.log(`\nupdated ${updated} source(s).`);
  console.log('Migration 016 complete. Run a scan to pick up events that were previously dropped.');
} finally {
  await sql.end();
}
