/**
 * Migration 018 — make extraction cheap, and make its cost visible.
 *
 * A full extraction pass was ~340k input and ~50k output tokens across 34
 * sources: about $3 on Opus, or roughly $1,000/month on a two-hourly cron.
 * Almost all of it was waste, in three ways.
 *
 * **Whole-page re-extraction.** Change detection hashed the whole page, so one
 * new headline on a forty-item feed re-extracted all forty — and busy sources
 * change most scans. `seen_items` records every entry already put in front of
 * the model, so a feed only ever costs its genuinely new entries.
 *
 * **A frontier model on structured text.** Reading "which disease, which
 * country, how many cases" out of cleaned text does not need Opus. Extraction
 * now defaults to Haiku, 5x cheaper both directions, with `config.model` as a
 * per-source override for the handful that earn it. WHO EMRO is the case that
 * justified keeping the override: a weaker model merged the Saudi-specific MERS
 * figures into the global total, and for a Saudi health authority that is the
 * row that matters.
 *
 * **No cost accounting at all.** Token usage was returned by the extractor and
 * then dropped, so the only way to discover spend was a billing alert. The
 * snapshot now records tokens, model and skip counts per source, which is what
 * `scripts/cost-report.mts` reads.
 *
 * Usage:  node migrations/018_extraction_economics.mjs [--apply]
 */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APPLY = process.argv.includes('--apply');

// Sources kept on a stronger model, with the reason. Everything else is Haiku.
const MODEL_OVERRIDES = {
  WHO_EMRO_MERS: ['claude-opus-5', 'Saudi-specific MERS figures are merged into the global total by weaker models'],
  WHO_DONS: ['claude-sonnet-5', 'Disease Outbreak News is the highest-value narrative source'],
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
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'source_snapshots'
      AND column_name IN ('input_tokens', 'output_tokens', 'extraction_model', 'items_skipped')`;
  const [tbl] = await sql`SELECT to_regclass('public.seen_items') AS t`;

  console.log('snapshot cost columns present :', cols.length);
  console.log('seen_items table present      :', tbl.t ? 'yes' : 'no');
  console.log('\nmodel overrides to set:');
  for (const [id, [model, why]] of Object.entries(MODEL_OVERRIDES)) {
    console.log(`  ${id.padEnd(16)} ${model.padEnd(18)} — ${why}`);
  }
  console.log('  everything else  claude-haiku-4-5   — default');

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to execute.');
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    await tx`
      CREATE TABLE IF NOT EXISTS seen_items (
        source_id     varchar(100) NOT NULL REFERENCES surveillance_sources(id) ON DELETE CASCADE,
        item_key      varchar(500) NOT NULL,
        first_seen_at timestamptz  NOT NULL DEFAULT now(),
        PRIMARY KEY (source_id, item_key)
      )
    `;
    // Old entries are pruned by age, not kept forever: a feed that drops an
    // item and later republishes it should be read again.
    await tx`CREATE INDEX IF NOT EXISTS seen_items_age ON seen_items (first_seen_at)`;
    console.log('created : seen_items');

    await tx`
      ALTER TABLE source_snapshots
        ADD COLUMN IF NOT EXISTS input_tokens     integer DEFAULT 0,
        ADD COLUMN IF NOT EXISTS output_tokens    integer DEFAULT 0,
        ADD COLUMN IF NOT EXISTS extraction_model varchar(40),
        ADD COLUMN IF NOT EXISTS items_skipped    integer DEFAULT 0
    `;
    console.log('altered : source_snapshots (cost accounting)');

    for (const [id, [model]] of Object.entries(MODEL_OVERRIDES)) {
      await tx`
        UPDATE surveillance_sources
        SET config = coalesce(config, '{}'::jsonb) || ${sql.json({ model })}, updated_at = now()
        WHERE id = ${id}`;
    }
    console.log(`set     : ${Object.keys(MODEL_OVERRIDES).length} model overrides`);
  });

  console.log('\nMigration 018 complete.');
  console.log('Check spend with: npx tsx scripts/cost-report.mts');
} finally {
  await sql.end();
}
