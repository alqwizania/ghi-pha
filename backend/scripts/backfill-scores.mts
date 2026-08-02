/**
 * Scores every unscored radar event and auto-promotes what clears the IHR
 * threshold. Safe to re-run — scored events are skipped.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/backfill-scores.mts            # report only
 *   npx tsx scripts/backfill-scores.mts --apply    # write scores and promote
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import {
  scoreEvent, shouldAutoPromote, SCORER_VERSION, type DiseaseBaseline,
} from '../src/services/signal-scoring.js';

const APPLY = process.argv.includes('--apply');

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

try {
  const baselineRows = await sql`SELECT * FROM disease_baselines`;
  const baselines: DiseaseBaseline[] = baselineRows.map((b: any) => ({
    disease: b.disease,
    country: b.country,
    endemicStatus: b.endemic_status,
    expectedAnnualCases: b.expected_annual_cases,
    baselineCfr: b.baseline_cfr === null ? null : Number(b.baseline_cfr),
    transmissionRoute: b.transmission_route,
    ihrNotifiable: b.ihr_notifiable,
    ihrAssessAlways: b.ihr_assess_always,
  }));

  const events = await sql`
    SELECT e.* FROM radar_events e
    LEFT JOIN event_scores s ON s.radar_event_id = e.id
    WHERE s.radar_event_id IS NULL
    ORDER BY e.date_reported DESC
  `;

  console.log(`baselines loaded : ${baselines.length}`);
  console.log(`events to score  : ${events.length}\n`);

  const tiers: Record<string, number> = { critical: 0, high: 0, moderate: 0, routine: 0 };
  const promotable: any[] = [];

  for (const e of events) {
    const result = scoreEvent(
      {
        disease: e.disease, country: e.country, cases: e.cases, deaths: e.deaths,
        title: e.title, summary: e.summary ?? '', dateReported: e.date_reported,
        sourceId: e.source_id ?? '',
      },
      baselines
    );
    tiers[result.tier]++;
    if (shouldAutoPromote(result) && !e.is_promoted) promotable.push({ e, result });

    if (APPLY) {
      await sql`
        INSERT INTO event_scores (radar_event_id, severity, unusualness, spread, trade_travel,
          ksa_relevance, domains_at_two, tier, mandatory_ihr, confidence, reports_occurrence, evidence, scorer_version)
        VALUES (${e.id}, ${result.severity.score}, ${result.unusualness.score}, ${result.spread.score},
          ${result.tradeTravel.score}, ${result.ksaRelevance.score}, ${result.domainsAtTwo},
          ${result.tier}, ${result.mandatoryIhr}, ${result.confidence},
          ${result.reportsOccurrence}, ${sql.json({
            severity: result.severity.reasons, unusualness: result.unusualness.reasons,
            spread: result.spread.reasons, tradeTravel: result.tradeTravel.reasons,
            ksaRelevance: result.ksaRelevance.reasons,
          })}, ${SCORER_VERSION})
        ON CONFLICT (radar_event_id) DO NOTHING
      `;
    }
  }

  console.log('tier distribution:');
  Object.entries(tiers).forEach(([t, n]) => console.log(`  ${t.padEnd(10)} ${String(n).padStart(4)}`));
  console.log(`\nwould auto-promote into triage: ${promotable.length}`);

  console.log('\ntop scoring events:');
  promotable
    .sort((a, b) => b.result.domainsAtTwo - a.result.domainsAtTwo)
    .slice(0, 12)
    .forEach(({ e, result }) => {
      const d = result;
      console.log(
        `  [${d.tier.toUpperCase().padEnd(8)}] sev${d.severity.score} unu${d.unusualness.score} spr${d.spread.score} ` +
        `trv${d.tradeTravel.score} ksa${d.ksaRelevance.score}  ${String(e.disease).substring(0, 26).padEnd(27)} ${String(e.country).substring(0, 20)}`
      );
      const why = [...d.severity.reasons, ...d.spread.reasons, ...d.ksaRelevance.reasons].slice(0, 2);
      why.forEach((r: string) => console.log(`             - ${r}`));
    });

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply.');
    process.exit(0);
  }

  console.log(`\nscores written: ${events.length}`);
  console.log('Promotion runs inside the collector; trigger a scan to promote.');
} finally {
  await sql.end();
}
