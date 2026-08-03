/**
 * Regression checks for the scoring rules.
 *
 * These exist because of a specific failure. The extractor read ten
 * epidemiological indicators off every source, the collector carried them to an
 * insert that had no column for them, and the scoring pass re-read the row from
 * the database — so every indicator rule was dead code for the life of the
 * feature. Nothing failed, no error was logged, and the scores looked
 * reasonable. The only way to catch that class of bug is to assert that a given
 * input produces a given score.
 *
 * Pure functions and fixed inputs: no database, no network, no API key.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/verify-scoring.mts
 */
import { scoreEvent, shouldAutoPromote, type DiseaseBaseline, type ScoringInput } from '../src/services/signal-scoring.js';
import { buildDraft } from '../src/services/assessment-drafter.js';

const BASELINES: DiseaseBaseline[] = [
  {
    disease: 'MERS-CoV', country: 'Saudi Arabia', endemicStatus: 'endemic',
    expectedAnnualCases: 200, baselineCfr: 35, transmissionRoute: 'respiratory',
    ihrNotifiable: false, ihrAssessAlways: true,
  },
  {
    disease: 'Cholera', country: null, endemicStatus: 'sporadic',
    expectedAnnualCases: 1000, baselineCfr: 1, transmissionRoute: 'faecal-oral',
    ihrNotifiable: false, ihrAssessAlways: false,
  },
  {
    disease: 'Influenza A(H5N1)', country: null, endemicStatus: 'absent',
    expectedAnnualCases: null, baselineCfr: 50, transmissionRoute: 'respiratory',
    ihrNotifiable: false, ihrAssessAlways: true,
  },
];

const base: ScoringInput = {
  disease: 'Cholera', country: 'Yemen', cases: 40, deaths: 1,
  title: 'Cholera cases reported', summary: 'Cases confirmed in the governorate.',
  dateReported: '2026-08-01', sourceId: 'WHO_DONS',
};

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

console.log('--- indicators must reach the domain scores ---');
// Each of these was dead code until migration 015 gave radar_events a column
// for indicators and the scoring pass started reading it back.
check(
  'novel pathogen drives unusualness to 3',
  scoreEvent({ ...base, indicators: { novelPathogen: true } }, BASELINES).unusualness.score,
  3
);
check(
  'healthcare-worker infection drives spread to 3',
  scoreEvent({ ...base, indicators: { healthcareWorkerInfections: true } }, BASELINES).spread.score,
  3
);
check(
  'human-to-human transmission drives spread to 3',
  scoreEvent({ ...base, indicators: { humanToHuman: true } }, BASELINES).spread.score,
  3
);
check(
  'travel restrictions drive trade/travel to 3',
  scoreEvent({ ...base, indicators: { travelRestrictions: true } }, BASELINES).tradeTravel.score,
  3
);
check(
  'multi-country reporting reaches spread 2',
  scoreEvent({ ...base, indicators: { multiCountry: true } }, BASELINES).spread.score >= 2,
  true
);
check(
  'no indicators leaves unusualness below the novelty ceiling',
  scoreEvent(base, BASELINES).unusualness.score < 3,
  true
);

console.log('\n--- indicators must be able to escalate a tier ---');
// Two domains at 2 is the Annex 2 notification rule; indicators alone should be
// able to get there, which is the whole reason they are collected.
const withIndicators = scoreEvent(
  { ...base, indicators: { novelPathogen: true, healthcareWorkerInfections: true } },
  BASELINES
);
check('two indicator-driven domains reach at least "high"', ['critical', 'high'].includes(withIndicators.tier), true);
check('and that event auto-promotes', shouldAutoPromote(withIndicators), true);

console.log('\n--- historical cumulative counts must not drive magnitude ---');
// The MERS case: 2,226 cases and 869 deaths since 2012 scored as 11.1x the
// expected annual total and made a routine surveillance page critical.
const mers: ScoringInput = {
  disease: 'MERS-CoV', country: 'Saudi Arabia', cases: 2226, deaths: 869,
  title: 'MERS situation update', summary: 'Global MERS-CoV situation as of June 2026.',
  dateReported: '2026-06-30', sourceId: 'WHO_EMRO_MERS',
};
const asCurrent = scoreEvent({ ...mers, countBasis: 'unknown' }, BASELINES);
const asHistoric = scoreEvent({ ...mers, countBasis: 'historical_cumulative', countPeriod: 'since 2012' }, BASELINES);

check('read as current, severity is maximal', asCurrent.severity.score, 3);
check('read as historical, severity drops', asHistoric.severity.score < asCurrent.severity.score, true);
check(
  'but the pathogen still carries severity on its own CFR',
  asHistoric.severity.score >= 2,
  true
);
check(
  'the exclusion is stated in the evidence',
  asHistoric.severity.reasons.some((r) => r.includes('historical') || r.includes('since 2012')),
  true
);
check(
  'no cumulative count is described as a multiple of the annual expectation',
  asHistoric.severity.reasons.some((r) => r.includes('expected annual total')),
  false
);

console.log('\n--- occurrence filter ---');
check(
  'a vaccination campaign does not report an occurrence',
  scoreEvent({
    ...base, disease: 'Poliomyelitis', cases: 0, deaths: 0,
    title: 'Polio vaccination campaign launched', summary: 'A campaign begins next week.',
  }, BASELINES).reportsOccurrence,
  false
);
check(
  'a reported case does',
  scoreEvent({ ...base, cases: 0, deaths: 0, title: 'Cholera outbreak declared', summary: 'Cases confirmed.' }, BASELINES).reportsOccurrence,
  true
);

console.log('\n--- baseline matching must not over-generalise ---');
// Generic "Influenza" once matched the H5N1 baseline and inherited its 50% CFR.
check(
  'generic influenza does not inherit the H5N1 baseline CFR',
  scoreEvent({ ...base, disease: 'Influenza', cases: 30, deaths: 0 }, BASELINES).severity.reasons
    .some((r) => r.includes('50%')),
  false
);

console.log('\n--- the draft must follow the score ---');
const draft = buildDraft({
  disease: 'MERS-CoV', country: 'Saudi Arabia', cases: 2226, deaths: 869,
  sourceName: 'WHO EMRO', dateReported: '2026-06-30',
  countBasis: 'historical_cumulative', countPeriod: 'since 2012',
  score: asHistoric,
});
check('Q1 mirrors the severity domain', draft.ihr.q1, asHistoric.severity.score >= 2);
check('Q3 mirrors the spread domain', draft.ihr.q3, asHistoric.spread.score >= 2);
check(
  'the hazard leg does not present a historical total as current incidence',
  draft.rra.hazard.includes('not current incidence'),
  true
);
check(
  'the cumulative basis is raised as an uncertainty',
  draft.rra.keyUncertainties.some((u) => u.includes('historical running total')),
  true
);
check(
  'a sub-threshold answer is not justified by evidence that argues the other way',
  !draft.ihr.q2 && draft.ihr.q2Notes.startsWith('Below the Annex 2 threshold'),
  true
);

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
