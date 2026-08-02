/**
 * Writes the machine draft into assessments created before migration 014.
 *
 * Only fills assessments where `machine_draft IS NULL`, and only where the
 * analyst has not already answered — an assessment someone has worked on keeps
 * whatever they wrote. Safe to re-run.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/backfill-assessment-drafts.mts            # report only
 *   npx tsx scripts/backfill-assessment-drafts.mts --apply    # write drafts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { buildDraft, scoreFromRow } from '../src/services/assessment-drafter.js';

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

/** postgres.js hands back `date` columns as Date; the Worker path gets strings. */
function isoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().substring(0, 10);
  return String(value).substring(0, 10);
}

try {
  // The score comes from event_scores where the signal carries a radar_event_id,
  // and otherwise from the copy the collector stashed on the signal itself.
  const rows = await sql`
    SELECT
      a.id, a.ihr_question_1, a.rra_hazard_assessment,
      s.disease, s.country, s.cases, s.deaths, s.source_name, s.date_reported,
      s.raw_data,
      es.severity, es.unusualness, es.spread, es.trade_travel, es.ksa_relevance,
      es.domains_at_two, es.tier, es.mandatory_ihr, es.confidence, es.evidence,
      es.reports_occurrence
    FROM assessments a
    JOIN signals s ON s.id = a.signal_id
    LEFT JOIN event_scores es ON es.radar_event_id = s.radar_event_id
    WHERE a.machine_draft IS NULL
    ORDER BY a.created_at DESC
  `;

  console.log(`assessments without a draft: ${rows.length}`);

  let drafted = 0;
  let skippedWorked = 0;
  let skippedNoScore = 0;

  for (const r of rows) {
    // Don't overwrite an analyst who has already answered.
    if (r.ihr_question_1 !== null || r.rra_hazard_assessment !== null) {
      skippedWorked++;
      continue;
    }

    const stored = (r.raw_data as any)?.score;
    const source = r.tier
      ? {
          severity: r.severity, unusualness: r.unusualness, spread: r.spread,
          tradeTravel: r.trade_travel, ksaRelevance: r.ksa_relevance,
          domainsAtTwo: r.domains_at_two, tier: r.tier, mandatoryIhr: r.mandatory_ihr,
          confidence: r.confidence, evidence: r.evidence,
          reportsOccurrence: r.reports_occurrence,
        }
      : stored
        ? {
            severity: stored.severity?.score ?? 0,
            unusualness: stored.unusualness?.score ?? 0,
            spread: stored.spread?.score ?? 0,
            tradeTravel: stored.tradeTravel?.score ?? 0,
            ksaRelevance: stored.ksaRelevance?.score ?? 0,
            domainsAtTwo: stored.domainsAtTwo ?? 0,
            tier: stored.tier ?? 'routine',
            mandatoryIhr: stored.mandatoryIhr ?? false,
            confidence: stored.confidence ?? 'medium',
            evidence: {
              severity: stored.severity?.reasons ?? [],
              unusualness: stored.unusualness?.reasons ?? [],
              spread: stored.spread?.reasons ?? [],
              tradeTravel: stored.tradeTravel?.reasons ?? [],
              ksaRelevance: stored.ksaRelevance?.reasons ?? [],
            },
          }
        : null;

    if (!source) {
      skippedNoScore++;
      continue;
    }

    const draft = buildDraft({
      disease: r.disease,
      country: r.country,
      cases: r.cases,
      deaths: r.deaths,
      sourceName: r.source_name,
      dateReported: isoDate(r.date_reported),
      score: scoreFromRow(source as any),
    });

    if (!APPLY) {
      if (drafted < 3) {
        console.log(`\n--- ${r.disease} / ${r.country} (${draft.tier})`);
        console.log(`IHR: Q1=${draft.ihr.q1} Q2=${draft.ihr.q2} Q3=${draft.ihr.q3} Q4=${draft.ihr.q4}` +
          ` -> ${draft.ihr.decision}`);
        console.log(`Risk: ${draft.rra.overallRisk} (confidence ${draft.rra.confidenceLevel})`);
        console.log(`Hazard: ${draft.rra.hazard}`);
        console.log(`Exposure: ${draft.rra.exposure}`);
        console.log(`Context: ${draft.rra.context}`);
        console.log(`Recommendations:\n  - ${draft.rra.recommendations.join('\n  - ')}`);
      }
      drafted++;
      continue;
    }

    await sql`
      UPDATE assessments SET
        ihr_question_1 = ${draft.ihr.q1}, ihr_question_1_notes = ${draft.ihr.q1Notes},
        ihr_question_2 = ${draft.ihr.q2}, ihr_question_2_notes = ${draft.ihr.q2Notes},
        ihr_question_3 = ${draft.ihr.q3}, ihr_question_3_notes = ${draft.ihr.q3Notes},
        ihr_question_4 = ${draft.ihr.q4}, ihr_question_4_notes = ${draft.ihr.q4Notes},
        ihr_decision = ${draft.ihr.decision},
        rra_hazard_assessment = ${sql.json(draft.rra.hazard)},
        rra_exposure_assessment = ${sql.json(draft.rra.exposure)},
        rra_context_assessment = ${sql.json(draft.rra.context)},
        rra_overall_risk = ${draft.rra.overallRisk},
        rra_confidence_level = ${draft.rra.confidenceLevel},
        rra_key_uncertainties = ${sql.json(draft.rra.keyUncertainties)},
        rra_recommendations = ${sql.json(draft.rra.recommendations)},
        machine_draft = ${sql.json(draft as any)},
        machine_drafter_version = ${draft.drafterVersion},
        machine_scorer_version = ${draft.scorerVersion},
        machine_generated_at = ${draft.generatedAt},
        machine_confidence = ${draft.rra.confidenceLevel},
        updated_at = now()
      WHERE id = ${r.id}
    `;
    drafted++;
  }

  console.log(`\ndrafted           : ${drafted}`);
  console.log(`skipped (worked)  : ${skippedWorked}`);
  console.log(`skipped (no score): ${skippedNoScore}`);
  if (!APPLY) console.log('\nDry run — nothing written. Re-run with --apply.');
} finally {
  await sql.end();
}
