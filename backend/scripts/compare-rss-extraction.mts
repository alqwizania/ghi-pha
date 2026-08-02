/**
 * Does structured extraction beat the RSS parser on RSS feeds?
 *
 * RSS already gives clean titles, links and dates, so the question is narrower
 * than it was for HTML: does the model recover epidemiological fields the feed
 * parser cannot? The RSS parser derives disease and country by keyword match
 * and always records cases and deaths as 0, so a bulletin reporting "1,200
 * cholera cases in Yemen" currently lands with zero counts.
 *
 * Usage:  cd backend && npx tsx scripts/compare-rss-extraction.mts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractEvents } from '../src/services/event-extractor.js';

const UA = 'GHI-PHA-Radar/1.0 (Public Health Authority, Saudi Arabia)';

function fromDevVars(key: string): string | undefined {
  try {
    const raw = readFileSync(fileURLToPath(new URL('../.dev.vars', import.meta.url)), 'utf8');
    const m = raw.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^"|"$/g, '') : undefined;
  } catch {
    return undefined;
  }
}

const apiKey = process.env.ANTHROPIC_API_KEY || fromDevVars('ANTHROPIC_API_KEY');
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is not set (environment or backend/.dev.vars).');
  process.exit(1);
}

const FEEDS: Array<[string, string]> = [
  ['CIDRAP_EBOLA', 'https://www.cidrap.umn.edu/news/64/rss'],
  ['CIDRAP_MEASLES', 'https://www.cidrap.umn.edu/news/78/rss'],
  ['PAHO', 'https://www.paho.org/en/rss.xml'],
];

function tags(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim());
  }
  return out;
}

let totalIn = 0;
let totalOut = 0;

for (const [id, url] of FEEDS) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const xml = await res.text();

  console.log(`\n${'='.repeat(78)}\n${id}\n${'='.repeat(78)}`);

  // What the RSS parser records today: title and date from the feed, disease
  // and country by keyword match, counts always zero.
  const titles = tags(xml, 'title').slice(1, 5);
  console.log('\n  RSS parser — title only, counts always 0:');
  titles.forEach((t) => console.log(`    • ${t.substring(0, 68)}`));

  const outcome = await extractEvents(apiKey, { id, name: id, url }, xml, false);
  totalIn += outcome.inputTokens ?? 0;
  totalOut += outcome.outputTokens ?? 0;

  console.log(`\n  Structured extraction  [${outcome.status}]:`);
  let withCounts = 0;
  for (const e of outcome.events.slice(0, 5)) {
    const counts = [
      e.cases != null ? `${e.cases} cases` : null,
      e.deaths != null ? `${e.deaths} deaths` : null,
    ].filter(Boolean).join(', ');
    if (counts) withCounts++;
    console.log(`    • ${e.title.substring(0, 68)}`);
    console.log(`        ${e.disease} — ${e.country}${e.dateReported ? ` — ${e.dateReported}` : ''}${counts ? ` — ${counts}` : ''}`);
  }
  console.log(`\n  events with real counts: ${withCounts} of ${Math.min(outcome.events.length, 5)} shown`);
  console.log(`  tokens: ${outcome.inputTokens} in / ${outcome.outputTokens} out`);
}

console.log(`\n${'='.repeat(78)}`);
console.log(`Totals: ${totalIn} in / ${totalOut} out — $${((totalIn / 1e6) * 5 + (totalOut / 1e6) * 25).toFixed(4)} for ${FEEDS.length} feeds.`);
console.log(`Per feed: $${(((totalIn / 1e6) * 5 + (totalOut / 1e6) * 25) / FEEDS.length).toFixed(4)}`);
