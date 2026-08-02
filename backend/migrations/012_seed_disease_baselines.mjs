/**
 * Migration 012 — seed the disease baseline reference table.
 *
 * This is curation, not engineering, and it is the highest-value dataset in
 * the system: without it severity scoring can only rank by raw case counts,
 * which surfaces large endemic caseloads and buries small anomalous ones.
 *
 * Three things are encoded per row:
 *
 *   endemic_status  — 'endemic' means cases are expected there and score lower
 *                     on unusualness; 'absent' means any case is an anomaly.
 *                     A NULL country is the global default; a country row
 *                     overrides it. MERS is sporadic globally and endemic in
 *                     Saudi Arabia, so a Saudi MERS case is far less unusual
 *                     than the same case in Europe.
 *
 *   baseline_cfr    — the disease's known case fatality ratio, so an observed
 *                     CFR can be judged against it rather than against an
 *                     arbitrary threshold.
 *
 *   ihr_notifiable / ihr_assess_always
 *                   — IHR (2005) Annex 2 obligations. The first list must be
 *                     notified to WHO on detection regardless of any scoring;
 *                     the second always requires the decision instrument to be
 *                     applied. These are legal obligations, not our judgement.
 *
 * Figures are indicative starting values drawn from published WHO/ECDC
 * ranges. They are meant to be corrected by PHA epidemiologists in use — the
 * table is deliberately editable rather than hardcoded.
 *
 * Usage:  node migrations/012_seed_disease_baselines.mjs [--apply]
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

// disease, country (null = global default), endemic_status, expected_annual_cases,
// baseline_cfr, transmission_route, ihr_notifiable, ihr_assess_always, notes
const BASELINES = [
  // --- IHR Annex 2: always notifiable to WHO on detection, regardless of score
  ['Smallpox', null, 'absent', 0, 30, 'respiratory', true, true, 'IHR Annex 2 — notify WHO on any detection'],
  ['Poliomyelitis', null, 'sporadic', null, 0.1, 'faecal-oral', true, true, 'IHR Annex 2 — wild-type poliovirus is always notifiable'],
  ['Wild poliovirus type 1 (WPV1)', null, 'sporadic', null, 0.1, 'faecal-oral', true, true, 'IHR Annex 2 — wild poliovirus'],
  ['SARS', null, 'absent', 0, 10, 'respiratory', true, true, 'IHR Annex 2 — notify WHO on any detection'],
  ['Influenza A(H5N1)', null, 'sporadic', null, 50, 'respiratory', true, true, 'Novel influenza subtype — IHR Annex 2'],
  ['Influenza A(H7N9)', null, 'sporadic', null, 39, 'respiratory', true, true, 'Novel influenza subtype — IHR Annex 2'],
  ['Influenza A(H9N2)', null, 'sporadic', null, 1, 'respiratory', true, true, 'Novel influenza subtype — IHR Annex 2'],

  // --- IHR Annex 2: always apply the decision instrument
  ['Cholera', null, 'sporadic', null, 1, 'faecal-oral', false, true, 'IHR Annex 2 second list. CFR under 1% with treatment, far higher without'],
  ['Plague', null, 'sporadic', null, 10, 'vector', false, true, 'Pneumonic plague is respiratory and far more severe'],
  ['Yellow fever', null, 'sporadic', null, 7.5, 'vector', false, true, 'IHR Annex 2 second list'],
  ['Ebola', null, 'sporadic', null, 50, 'contact', false, true, 'Viral haemorrhagic fever — IHR Annex 2 second list'],
  ['Marburg', null, 'sporadic', null, 50, 'contact', false, true, 'Viral haemorrhagic fever'],
  ['Lassa fever', null, 'endemic', null, 15, 'contact', false, true, 'Endemic in West Africa'],
  ['Crimean-Congo haemorrhagic fever', null, 'sporadic', null, 30, 'vector', false, true, 'Viral haemorrhagic fever'],
  ['West Nile virus', null, 'sporadic', null, 4, 'vector', false, true, 'IHR Annex 2 second list'],
  ['Nipah virus', null, 'sporadic', null, 70, 'contact', false, true, 'Very high CFR, human-to-human transmission documented'],

  // --- Regionally critical for Saudi Arabia
  ['MERS-CoV', null, 'sporadic', null, 35, 'respiratory', false, true, 'Regionally critical — always assess'],
  ['MERS-CoV', 'Saudi Arabia', 'endemic', 200, 35, 'respiratory', false, true, 'Endemic in KSA; sporadic camel-linked cases expected'],
  ['MERS-CoV', 'United Arab Emirates', 'endemic', 20, 35, 'respiratory', false, true, 'Endemic in the Gulf'],
  ['MERS-CoV', 'Qatar', 'endemic', 10, 35, 'respiratory', false, true, 'Endemic in the Gulf'],
  ['Meningococcal disease', null, 'sporadic', null, 10, 'respiratory', false, true, 'Hajj-associated risk; vaccination is a visa requirement'],
  ['Neisseria meningitidis', null, 'sporadic', null, 10, 'respiratory', false, true, 'Hajj-associated risk'],
  ['Dengue', null, 'endemic', null, 0.5, 'vector', false, true, 'Endemic across the tropics'],
  ['Dengue', 'Saudi Arabia', 'endemic', 3000, 0.1, 'vector', false, true, 'Endemic in Jeddah, Makkah and Jazan'],
  ['Rift Valley fever', null, 'sporadic', null, 1, 'vector', false, true, 'Livestock-linked; regional relevance via animal trade'],

  // --- Common, high-volume — endemic status keeps them from dominating on count
  ['COVID-19', null, 'endemic', null, 0.5, 'respiratory', false, false, 'Endemic worldwide; only anomalies should score'],
  ['Measles', null, 'sporadic', null, 0.2, 'respiratory', false, false, 'Vaccine-preventable; resurgence is the signal'],
  ['Influenza', null, 'endemic', null, 0.1, 'respiratory', false, false, 'Seasonal endemic; novel subtypes are handled separately'],
  ['Mpox', null, 'sporadic', null, 3, 'contact', false, true, 'PHEIC history; clade I is markedly more severe'],
  ['Diphtheria', null, 'sporadic', null, 10, 'respiratory', false, false, 'Vaccine-preventable'],
  ['Hepatitis A', null, 'endemic', null, 0.3, 'faecal-oral', false, false, ''],
  ['Typhoid', null, 'endemic', null, 1, 'faecal-oral', false, false, ''],
  ['Malaria', null, 'endemic', null, 0.3, 'vector', false, false, ''],
  ['Malaria', 'Saudi Arabia', 'sporadic', 100, 0.3, 'vector', false, true, 'Near-elimination in KSA; local transmission is notable'],
  ['Legionellosis', null, 'sporadic', null, 10, 'environmental', false, false, ''],
  ['Anthrax', null, 'sporadic', null, 20, 'contact', false, true, 'Deliberate-release potential'],
  ['Rabies', null, 'sporadic', null, 99, 'contact', false, false, 'Near-universal CFR once symptomatic'],
  ['Chikungunya', null, 'endemic', null, 0.1, 'vector', false, false, ''],
  ['Zika', null, 'sporadic', null, 0.1, 'vector', false, true, 'Congenital syndrome risk'],
  ['Hantavirus', null, 'sporadic', null, 35, 'environmental', false, true, 'Andes hantavirus shows human-to-human transmission'],
  ['Andes hantavirus', null, 'sporadic', null, 35, 'contact', false, true, 'Documented human-to-human transmission'],
  ['Cyclosporiasis', null, 'sporadic', null, 0.1, 'foodborne', false, false, 'Foodborne; outbreaks are usually produce-linked'],
  ['Listeriosis', null, 'sporadic', null, 20, 'foodborne', false, false, ''],
  ['Salmonellosis', null, 'endemic', null, 0.1, 'foodborne', false, false, ''],
  ['Botulism', null, 'sporadic', null, 5, 'foodborne', false, true, 'Deliberate-release potential'],
];

const sql = postgres(connectionString(), { ssl: 'require' });

try {
  console.log(`baseline rows to seed: ${BASELINES.length}`);
  console.log(`  IHR always-notifiable : ${BASELINES.filter((b) => b[6]).length}`);
  console.log(`  IHR always-assess     : ${BASELINES.filter((b) => b[7]).length}`);
  console.log(`  country-specific      : ${BASELINES.filter((b) => b[1]).length}`);

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to execute.');
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    for (const [disease, country, status, expected, cfr, route, notifiable, assess, notes] of BASELINES) {
      await tx`
        INSERT INTO disease_baselines
          (disease, country, endemic_status, expected_annual_cases, baseline_cfr,
           transmission_route, ihr_notifiable, ihr_assess_always, notes)
        VALUES (${disease}, ${country}, ${status}, ${expected}, ${cfr},
                ${route}, ${notifiable}, ${assess}, ${notes})
        ON CONFLICT (lower(disease), coalesce(lower(country), '*')) DO UPDATE SET
          endemic_status = EXCLUDED.endemic_status,
          expected_annual_cases = EXCLUDED.expected_annual_cases,
          baseline_cfr = EXCLUDED.baseline_cfr,
          transmission_route = EXCLUDED.transmission_route,
          ihr_notifiable = EXCLUDED.ihr_notifiable,
          ihr_assess_always = EXCLUDED.ihr_assess_always,
          notes = EXCLUDED.notes,
          updated_at = now()
      `;
    }
  });

  const [{ n }] = await sql`SELECT count(*)::int AS n FROM disease_baselines`;
  console.log(`\nbaseline rows: ${n}`);
  console.log('Migration 012 complete.');
} finally {
  await sql.end();
}
