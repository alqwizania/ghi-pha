/**
 * Prints the machine draft that would be written if each pending signal were
 * accepted right now. Read-only.
 *
 * The drafts are what analysts will open, so they should be reviewed as prose
 * and not only as data — a draft that reads as though nobody checked it will
 * teach people to skip past it, which is worse than an empty form.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/preview-assessment-drafts.mts [--limit 5]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { buildDraft, scoreFromRow } from '../src/services/assessment-drafter.js';

const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 10;

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
  const rows = await sql`
    SELECT s.disease, s.country, s.cases, s.deaths, s.source_name, s.date_reported,
           es.severity, es.unusualness, es.spread, es.trade_travel, es.ksa_relevance,
           es.domains_at_two, es.tier, es.mandatory_ihr, es.confidence, es.evidence,
           es.reports_occurrence
    FROM signals s
    JOIN event_scores es ON es.radar_event_id = s.radar_event_id
    WHERE s.triage_status = 'Pending Triage'
    ORDER BY
      CASE es.tier WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END,
      s.created_at DESC
    LIMIT ${LIMIT}
  `;

  console.log(`${rows.length} pending signal(s) with a score\n`);

  for (const r of rows) {
    const draft = buildDraft({
      disease: r.disease,
      country: r.country,
      cases: r.cases,
      deaths: r.deaths,
      sourceName: r.source_name,
      dateReported: isoDate(r.date_reported),
      score: scoreFromRow({
        severity: r.severity, unusualness: r.unusualness, spread: r.spread,
        tradeTravel: r.trade_travel, ksaRelevance: r.ksa_relevance,
        domainsAtTwo: r.domains_at_two, tier: r.tier, mandatoryIhr: r.mandatory_ihr,
        confidence: r.confidence, evidence: r.evidence, reportsOccurrence: r.reports_occurrence,
      }),
    });

    console.log('='.repeat(78));
    console.log(`${r.disease} — ${r.country}   [${draft.tier}]   ${r.source_name}`);
    console.log('='.repeat(78));
    console.log(`\nIHR ANNEX 2 — ${draft.ihr.decision} (${draft.ihr.yesCount}/4 yes)`);
    console.log(`  ${draft.ihr.decisionRationale}`);
    console.log(`\n  Q1 serious public health impact?   ${draft.ihr.q1 ? 'YES' : 'NO '}  ${draft.ihr.q1Notes}`);
    console.log(`  Q2 unusual or unexpected?          ${draft.ihr.q2 ? 'YES' : 'NO '}  ${draft.ihr.q2Notes}`);
    console.log(`  Q3 risk of international spread?   ${draft.ihr.q3 ? 'YES' : 'NO '}  ${draft.ihr.q3Notes}`);
    console.log(`  Q4 risk of travel/trade measures?  ${draft.ihr.q4 ? 'YES' : 'NO '}  ${draft.ihr.q4Notes}`);
    console.log(`\nRRA — risk ${draft.rra.overallRisk}, confidence ${draft.rra.confidenceLevel}`);
    console.log(`  Hazard   : ${draft.rra.hazard}`);
    console.log(`  Exposure : ${draft.rra.exposure}`);
    console.log(`  Context  : ${draft.rra.context}`);
    console.log(`\n  Uncertainties:\n    - ${draft.rra.keyUncertainties.join('\n    - ')}`);
    console.log(`\n  Recommendations:\n    - ${draft.rra.recommendations.join('\n    - ')}`);
    console.log();
  }
} finally {
  await sql.end();
}
