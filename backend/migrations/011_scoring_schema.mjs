/**
 * Migration 011 — priority scoring schema.
 *
 * Three tables implement the scoring model from the architecture plan, which
 * scores signals on the same axes as IHR (2005) Annex 2 so a high triage score
 * predicts the IHR outcome rather than being a separate opinion about it.
 *
 *   disease_baselines — what "expected" looks like per disease per country.
 *     Anomaly is deviation from expectation, not magnitude: 40 cholera cases in
 *     Yemen during an ongoing epidemic is background, 4 in Riyadh is an
 *     emergency. Without this table severity scoring can only rank by raw
 *     counts, which is the mistake the whole model exists to avoid.
 *
 *   event_scores — the five domain sub-scores per radar event, plus the
 *     evidence that produced each. Storing only a total would make every
 *     escalation unauditable; an analyst has to be able to see why something
 *     scored high and challenge it.
 *
 *   signal_links — corroboration between signals. When an official source
 *     confirms a social one, that independent agreement raises confidence (not
 *     severity) and lets the social signal graduate out of verification.
 *
 * Usage:  node migrations/011_scoring_schema.mjs [--apply]
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
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_name IN ('disease_baselines', 'event_scores', 'signal_links')`;
  const have = new Set(tables.map((t) => t.table_name));
  console.log('existing:', [...have].join(', ') || 'none');

  if (!APPLY) {
    console.log('\nWould create: disease_baselines, event_scores, signal_links');
    console.log('Dry run — nothing changed. Re-run with --apply to execute.');
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    // A NULL country row is the global default for that disease; a row with a
    // country overrides it. So MERS is 'sporadic' globally but 'endemic' in
    // Saudi Arabia, and a Saudi MERS case scores lower on unusualness than the
    // same case in Europe.
    await tx`
      CREATE TABLE IF NOT EXISTS disease_baselines (
        id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        disease               varchar(120) NOT NULL,
        country               varchar(100),
        endemic_status        varchar(20)  NOT NULL DEFAULT 'absent',
        expected_annual_cases integer,
        baseline_cfr          numeric(5,2),
        transmission_route    varchar(40),
        ihr_notifiable        boolean      NOT NULL DEFAULT false,
        ihr_assess_always     boolean      NOT NULL DEFAULT false,
        notes                 text,
        updated_at            timestamptz  NOT NULL DEFAULT now()
      )
    `;
    await tx`
      CREATE UNIQUE INDEX IF NOT EXISTS disease_baselines_key
      ON disease_baselines (lower(disease), coalesce(lower(country), '*'))
    `;
    console.log('created  : disease_baselines');

    await tx`
      CREATE TABLE IF NOT EXISTS event_scores (
        radar_event_id  uuid PRIMARY KEY REFERENCES radar_events(id) ON DELETE CASCADE,
        severity        smallint NOT NULL DEFAULT 0,
        unusualness     smallint NOT NULL DEFAULT 0,
        spread          smallint NOT NULL DEFAULT 0,
        trade_travel    smallint NOT NULL DEFAULT 0,
        ksa_relevance   smallint NOT NULL DEFAULT 0,
        domains_at_two  smallint NOT NULL DEFAULT 0,
        tier            varchar(12) NOT NULL DEFAULT 'routine',
        mandatory_ihr   boolean  NOT NULL DEFAULT false,
        confidence      varchar(10) NOT NULL DEFAULT 'medium',
        evidence        jsonb    NOT NULL DEFAULT '{}'::jsonb,
        scorer_version  varchar(20) NOT NULL,
        scored_at       timestamptz NOT NULL DEFAULT now()
      )
    `;
    await tx`CREATE INDEX IF NOT EXISTS event_scores_tier_idx ON event_scores (tier, scored_at DESC)`;
    console.log('created  : event_scores');

    await tx`
      CREATE TABLE IF NOT EXISTS signal_links (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        from_type   varchar(20) NOT NULL,
        from_id     uuid NOT NULL,
        to_type     varchar(20) NOT NULL,
        to_id       uuid NOT NULL,
        link_type   varchar(20) NOT NULL,
        confidence  numeric(3,2),
        rationale   text,
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `;
    await tx`
      CREATE UNIQUE INDEX IF NOT EXISTS signal_links_pair
      ON signal_links (from_type, from_id, to_type, to_id, link_type)
    `;
    console.log('created  : signal_links');

    // Lets a signal point back at the score that promoted it, so triage can
    // show why an item arrived without recomputing anything.
    await tx`
      ALTER TABLE signals
        ADD COLUMN IF NOT EXISTS source_stream    varchar(20) NOT NULL DEFAULT 'radar',
        ADD COLUMN IF NOT EXISTS radar_event_id   uuid REFERENCES radar_events(id),
        ADD COLUMN IF NOT EXISTS auto_promoted    boolean NOT NULL DEFAULT false
    `;
    console.log('altered  : signals (source_stream, radar_event_id, auto_promoted)');
  });

  console.log('\nMigration 011 complete.');
} finally {
  await sql.end();
}
