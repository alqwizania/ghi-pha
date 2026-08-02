/**
 * Quality review for the structured-extraction pilot.
 *
 * Fetches each pilot source live, runs both extractors over the same content,
 * and prints them side by side so you can judge whether the model's output is
 * what an analyst would have recorded — before switching the rest of the
 * registry over.
 *
 * Reads ANTHROPIC_API_KEY from the environment or backend/.dev.vars.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/verify-extraction.mts            # all pilot sources
 *   npx tsx scripts/verify-extraction.mts ECDC       # just one
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { extractEvents, htmlToText } from '../src/services/event-extractor.js';

const UA = 'GHI-PHA-Radar/1.0 (Public Health Authority, Saudi Arabia)';

function fromDevVars(key: string): string | undefined {
  try {
    const raw = readFileSync(fileURLToPath(new URL('../.dev.vars', import.meta.url)), 'utf8');
    const match = raw.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return match ? match[1].trim().replace(/^"|"$/g, '') : undefined;
  } catch {
    return undefined;
  }
}

const apiKey = process.env.ANTHROPIC_API_KEY || fromDevVars('ANTHROPIC_API_KEY');
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is not set.\n');
  console.error('Add it to backend/.dev.vars as:');
  console.error('  ANTHROPIC_API_KEY="sk-ant-..."\n');
  console.error('Create a key at https://console.anthropic.com/settings/keys');
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL || fromDevVars('DATABASE_URL');
if (!dbUrl) {
  console.error('DATABASE_URL not found in environment or .dev.vars');
  process.exit(1);
}

/** What the legacy title scraper pulls out — the thing we are replacing. */
function naiveTitles(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const patterns = [
    /<h[23][^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h[23]>/gi,
    /<a[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
    /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi,
    /<article[^>]*>[\s\S]*?<(?:h[234]|a)[^>]*>([\s\S]*?)<\/(?:h[234]|a)>/gi,
  ];
  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(html)) !== null && out.length < 10) {
      const t = m[1].replace(/<[^>]*>/g, '').trim();
      if (!t || t.length < 15 || t.length > 300 || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out;
}

const only = process.argv[2];
const sql = postgres(dbUrl, { ssl: 'require' });

try {
  const sources = await sql<{ id: string; name: string; url: string; fetch_strategy: string }[]>`
    SELECT id, name, url, fetch_strategy
    FROM surveillance_sources
    WHERE parser_hint = 'ai' AND enabled ${only ? sql`AND id = ${only}` : sql``}
    ORDER BY id
  `;

  if (sources.length === 0) {
    console.error(only ? `No enabled source with parser_hint='ai' and id=${only}` : "No sources have parser_hint='ai'");
    process.exit(1);
  }

  let totalIn = 0;
  let totalOut = 0;

  for (const source of sources) {
    console.log(`\n${'='.repeat(78)}`);
    console.log(`${source.name}  [${source.id}]`);
    console.log(`${source.url}`);
    console.log('='.repeat(78));

    const res = await fetch(source.url, { headers: { 'User-Agent': UA } });
    if (!res.ok) {
      console.log(`  fetch failed: HTTP ${res.status}`);
      continue;
    }
    const body = await res.text();
    const isHtml = source.fetch_strategy !== 'json';

    console.log(`\n  raw ${body.length} bytes -> cleaned ${htmlToText(body).length} chars\n`);

    console.log('  BEFORE — legacy title scraper:');
    const naive = naiveTitles(body);
    if (naive.length === 0) console.log('    (nothing extracted)');
    naive.forEach((t) => console.log(`    • ${t.substring(0, 72)}`));

    const outcome = await extractEvents(apiKey, source, body, isHtml);
    totalIn += outcome.inputTokens ?? 0;
    totalOut += outcome.outputTokens ?? 0;

    console.log(`\n  AFTER — structured extraction  [${outcome.status}] ${outcome.detail}`);
    if (outcome.events.length === 0) console.log('    (no outbreak events found)');
    for (const e of outcome.events) {
      const counts = [
        e.cases != null ? `${e.cases} cases` : null,
        e.deaths != null ? `${e.deaths} deaths` : null,
      ].filter(Boolean).join(', ');
      console.log(`    • ${e.title.substring(0, 72)}`);
      console.log(`        ${e.disease} — ${e.country}${e.dateReported ? ` — ${e.dateReported}` : ''}${counts ? ` — ${counts}` : ''}`);
    }
    if (outcome.inputTokens) {
      console.log(`\n  tokens: ${outcome.inputTokens} in / ${outcome.outputTokens} out`);
    }
  }

  console.log(`\n${'='.repeat(78)}`);
  console.log(`Totals across ${sources.length} source(s): ${totalIn} input tokens, ${totalOut} output tokens.`);
  console.log('At Opus 5 rates ($5/$25 per million) that is about');
  console.log(`  $${((totalIn / 1e6) * 5 + (totalOut / 1e6) * 25).toFixed(4)} for this run.`);
  console.log('\nA scan only extracts when a page changed, so real cost tracks how often');
  console.log('these agencies publish, not how often the cron runs.');
} finally {
  await sql.end();
}
