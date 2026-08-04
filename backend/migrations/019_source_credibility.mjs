/**
 * Migration 019 — source credibility as data.
 *
 * Credibility lived in a hardcoded Set in signal-scoring.ts: a source was
 * either in HIGH_CONFIDENCE_SOURCES or it was 'medium'. Adding a source meant
 * editing code, and there was no way to express that Reuters is more reliable
 * than a local paper but less than WHO.
 *
 * Tiers follow the operational question "how much would I stake on this being
 * true before anyone verifies it", which is the only question confidence
 * answers:
 *
 *   100  multilateral and national public health authorities publishing in
 *        their own name — WHO, CDC, ECDC, Africa CDC, PAHO, UKHSA
 *    95  national ministries of health
 *    90  moderated early-warning networks — ProMED, Global.health
 *    85  international news agencies with standards desks — Reuters, AP, AFP
 *    80  humanitarian reporting — ReliefWeb, OCHA, IFRC
 *    75  specialist health press — CIDRAP
 *    70  major newspapers and broadcasters
 *    65  preprint servers — medRxiv, bioRxiv. Deliberately below the news
 *        agencies: a preprint has not been peer reviewed, and treating it as
 *        "scientific therefore reliable" is how a withdrawn paper becomes a
 *        national alert.
 *    60  local news
 *    30  social media
 *
 * Confidence stays orthogonal to severity. WHO's Rapid Risk Assessment keeps
 * risk level and confidence level apart on purpose: a Critical rumour and a
 * Critical confirmed outbreak demand different actions, and a single blended
 * number cannot tell an analyst which one they are looking at.
 *
 * Usage:  node migrations/019_source_credibility.mjs [--apply]
 */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APPLY = process.argv.includes('--apply');

// Prefix match on source id -> [score, tier label]. Longest prefix wins.
const RULES = [
  ['WHO', [100, 'authority']],
  ['ECDC', [100, 'authority']],
  ['CDC', [100, 'authority']],
  ['PAHO', [100, 'authority']],
  ['AFRICA_CDC', [100, 'authority']],
  ['UK_UKHSA', [100, 'authority']],
  ['UK_HPR', [100, 'authority']],
  ['GPEI', [100, 'authority']],
  ['GTFCC', [100, 'authority']],
  ['GERMANY_RKI', [95, 'national_moh']],
  ['JAPAN_MHLW', [95, 'national_moh']],
  ['CHINA_CDC', [95, 'national_moh']],
  ['ITALY_HEALTH', [95, 'national_moh']],
  ['HONG_KONG_CHP', [95, 'national_moh']],
  ['CANADA', [95, 'national_moh']],
  ['SAUDI', [95, 'national_moh']],
  ['PROMED', [90, 'early_warning']],
  ['GLOBAL_HEALTH', [90, 'early_warning']],
  ['HEALTHMAP', [90, 'early_warning']],
  ['RELIEFWEB', [80, 'humanitarian']],
  ['OCHA', [80, 'humanitarian']],
  ['IFRC', [80, 'humanitarian']],
  ['WOAH', [95, 'authority']],
  ['OIE', [95, 'authority']],
  ['FAO', [95, 'authority']],
  ['CIDRAP', [75, 'specialist_press']],
  ['REUTERS', [85, 'news_agency']],
  ['AP_', [85, 'news_agency']],
  ['AFP', [85, 'news_agency']],
  ['BBC', [70, 'major_news']],
  ['ALJAZEERA', [70, 'major_news']],
  ['MEDRXIV', [65, 'preprint']],
  ['BIORXIV', [65, 'preprint']],
  ['PUBMED', [85, 'peer_reviewed']],
  ['NEWS_MEDICAL', [60, 'local_news']],
  ['GOOGLE', [60, 'local_news']],
  ['BEACON', [75, 'specialist_press']],
];

function classify(id) {
  let best = null;
  for (const [prefix, val] of RULES) {
    if (id.toUpperCase().startsWith(prefix) && (!best || prefix.length > best[0].length)) {
      best = [prefix, val];
    }
  }
  return best ? best[1] : [70, 'unclassified'];
}

function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const devVars = readFileSync(fileURLToPath(new URL('../.dev.vars', import.meta.url)), 'utf8');
  const match = devVars.match(/^DATABASE_URL=(.*)$/m);
  if (!match) throw new Error('DATABASE_URL not found in environment or .dev.vars');
  return match[1].trim().replace(/^"|"$/g, '');
}

const sql = postgres(connectionString(), { ssl: 'require' });

try {
  const sources = await sql`SELECT id, name FROM surveillance_sources ORDER BY id`;
  const plan = sources.map((s) => ({ id: s.id, ...(() => { const [score, tier] = classify(s.id); return { score, tier }; })() }));

  const byTier = {};
  for (const p of plan) byTier[p.tier] = (byTier[p.tier] ?? 0) + 1;
  console.log('sources by credibility tier:');
  for (const [tier, n] of Object.entries(byTier).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${tier.padEnd(18)} ${n}`);
  }
  const unclassified = plan.filter((p) => p.tier === 'unclassified');
  if (unclassified.length) {
    console.log(`\nunclassified (default 70): ${unclassified.map((p) => p.id).join(', ')}`);
  }

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to execute.');
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    await tx`
      ALTER TABLE surveillance_sources
        ADD COLUMN IF NOT EXISTS credibility_score integer     DEFAULT 70 NOT NULL,
        ADD COLUMN IF NOT EXISTS credibility_tier  varchar(24) DEFAULT 'unclassified' NOT NULL
    `;
    console.log('altered : surveillance_sources (credibility_score, credibility_tier)');

    for (const p of plan) {
      await tx`
        UPDATE surveillance_sources
        SET credibility_score = ${p.score}, credibility_tier = ${p.tier}, updated_at = now()
        WHERE id = ${p.id}`;
    }
    console.log(`scored  : ${plan.length} sources`);

    // Corroboration needs somewhere to record that confidence was raised, and
    // by what. Storing only the final number would make it unauditable, which
    // is the same mistake storing only a total score would have been.
    await tx`
      ALTER TABLE event_scores
        ADD COLUMN IF NOT EXISTS credibility        integer DEFAULT 70,
        ADD COLUMN IF NOT EXISTS corroboration      integer DEFAULT 0,
        ADD COLUMN IF NOT EXISTS confidence_score   integer DEFAULT 0
    `;
    console.log('altered : event_scores (credibility, corroboration, confidence_score)');
  });

  console.log('\nMigration 019 complete. Re-score with: npx tsx scripts/backfill-scores.mts --apply');
} finally {
  await sql.end();
}
