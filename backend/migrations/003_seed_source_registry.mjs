/**
 * Migration 003 — seed the merged source registry.
 *
 * Two inputs are reconciled here:
 *
 *   - The 42-source manifest curated for the SehaRadar project, which is the
 *     genuinely valuable artifact inherited from that codebase.
 *   - GHI's own working fetchers, which already retrieve eight of these
 *     sources reliably and whose URLs are known-good after the 2 Aug repairs.
 *
 * Where both describe the same agency, GHI's verified URL and strategy win —
 * the manifest's entry points at a page meant for a browser-based watcher, not
 * at the feed we can parse directly. Sources GHI does not yet cover are added
 * with a best-guess strategy and left for the collector to prove or disprove.
 *
 * Usage:  node migrations/003_seed_source_registry.mjs [--apply]
 */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');

function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const devVars = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
  const match = devVars.match(/^DATABASE_URL=(.*)$/m);
  if (!match) throw new Error('DATABASE_URL not found in environment or .dev.vars');
  return match[1].trim().replace(/^"|"$/g, '');
}

/**
 * Sources GHI fetches successfully today. These override anything the manifest
 * says about the same agency, because these URLs are verified working.
 * `parserHint` names the extractor in radar-collector.ts.
 */
const VERIFIED = [
  { id: 'WHO_DONS', name: 'WHO Disease Outbreak News', strategy: 'json', parser: 'who_dons', hours: 1, boost: 3,
    url: 'https://www.who.int/api/news/diseaseoutbreaknews?sf_culture=en&$orderby=PublicationDate%20desc&$top=30' },
  { id: 'WHO_MPX_API', name: 'WHO Mpox Daily Validated API', strategy: 'json', parser: 'who_mpox', hours: 6, boost: 2,
    url: 'https://xmart-api-public.who.int/MPX/V_MPX_VALIDATED_DAILY?$orderby=DATE%20desc&$top=300' },
  { id: 'CDC_TRAVEL', name: 'CDC Travel Health Notices', strategy: 'rss', parser: 'rss', hours: 3, boost: 1,
    url: 'https://tools.cdc.gov/api/v2/resources/media/316422.rss' },
  { id: 'PAHO', name: 'PAHO Pan American Health', strategy: 'rss', parser: 'rss', hours: 3, boost: 1,
    url: 'https://www.paho.org/en/rss.xml' },
  { id: 'WHO_NEWS', name: 'WHO News & Features', strategy: 'rss', parser: 'rss', hours: 6, boost: 0,
    url: 'https://www.who.int/rss-feeds/news-english.xml' },
  { id: 'WHO_AFRO', name: 'WHO AFRO Africa Outbreaks', strategy: 'html', parser: 'html_titles', hours: 3, boost: 1,
    url: 'https://www.afro.who.int/health-topics/disease-outbreaks' },
  { id: 'ECDC', name: 'ECDC Communicable Disease Threats', strategy: 'html', parser: 'html_titles', hours: 3, boost: 1,
    url: 'https://www.ecdc.europa.eu/en/threats-and-outbreaks' },
];

// CIDRAP publishes only on per-topic feeds; its site-wide rss.xml has been
// frozen since 2022. Each topic is registered as its own source so a single
// dead topic is visible rather than hidden inside an aggregate.
const CIDRAP_TOPICS = [
  ['Misc Emerging Topics', '31175', 2], ['COVID-19', '178636', 1], ['Avian Influenza', '49', 3],
  ['Measles', '78', 1], ['Ebola', '64', 2], ['Mpox', '230556', 2],
  ['Cholera', '58', 2], ['MERS-CoV', '84', 3],
];

/** Sources GHI cannot fetch yet, with the reason recorded. */
const BLOCKED = {
  RELIEFWEB: 'API v1 decommissioned; v2 requires an approved appname from apidoc.reliefweb.int',
  PROMED: 'All published feed paths return 404; ProMED appears to be behind a subscription portal',
  GOOGLE: 'Requires a Google Custom Search API key',
  WHO_CLONE: 'Test site, not a real source',
};

/**
 * Registered but not fetchable — kept visible so the sources drawer shows why
 * a known agency is absent rather than silently omitting it.
 */
const EXTRA_DISABLED = [
  { id: 'RELIEFWEB', name: 'ReliefWeb Health & Epidemic Reports', type: 'api',
    url: 'https://api.reliefweb.int/v2/reports', parser: 'reliefweb' },
];

const sql = postgres(connectionString(), { ssl: 'require' });

try {
  const manifest = JSON.parse(
    readFileSync(new URL('../../new features for AI to implement/Global_Radar/config/sources.json', import.meta.url), 'utf8')
  );

  const rows = new Map();

  // 1. Manifest entries first — they carry the curated intervals and tags.
  for (const s of manifest.sources) {
    const isRsshub = s.type === 'rsshub';
    const blocked = BLOCKED[s.id];
    rows.set(s.id, {
      id: s.id,
      name: s.name,
      type: s.type,
      // The Google Custom Search entry carries no URL — it is an API
      // integration rather than a page — so fall back to a placeholder that
      // keeps the NOT NULL column satisfied while it sits disabled.
      url: s.url || `urn:ghi:source:${s.id.toLowerCase()}`,
      // A manifest entry typed `changedetection` is a page meant to be watched
      // by a browser-based tool, so plain HTML extraction is the starting point.
      fetch_strategy: isRsshub ? 'rsshub' : 'html',
      parser_hint: s.parser ?? null,
      priority_boost: s.priority_boost ?? 0,
      fetch_interval_hours: Math.max(1, Math.round((s.check_interval?.hours ?? 0) + (s.check_interval?.minutes ?? 0) / 60)) || 1,
      tags: s.tags ?? [],
      config: s.config ?? {},
      enabled: s.enabled !== false && !blocked && !isRsshub,
      disabled_reason:
        blocked ??
        (isRsshub ? 'Needs a self-hosted RSSHub instance; deferred' : null) ??
        (s.enabled === false ? 'Disabled in the inherited source manifest' : null),
      category: 'biological',
    });
  }

  for (const e of EXTRA_DISABLED) {
    rows.set(e.id, {
      id: e.id, name: e.name, type: e.type, url: e.url,
      fetch_strategy: 'json', parser_hint: e.parser, priority_boost: 0,
      fetch_interval_hours: 6, tags: ['health-surveillance'], config: {},
      enabled: false, disabled_reason: BLOCKED[e.id], category: 'biological',
    });
  }

  // 2. Verified GHI fetchers override the manifest for the same agency.
  for (const v of VERIFIED) {
    const prior = rows.get(v.id);
    rows.set(v.id, {
      ...(prior ?? { tags: [], config: {}, category: 'biological' }),
      id: v.id,
      name: v.name,
      type: v.strategy,
      url: v.url,
      fetch_strategy: v.strategy,
      parser_hint: v.parser,
      priority_boost: v.boost,
      fetch_interval_hours: v.hours,
      enabled: true,
      disabled_reason: null,
    });
  }

  // 3. CIDRAP topic feeds.
  for (const [topic, feedId, boost] of CIDRAP_TOPICS) {
    const id = `CIDRAP_${topic.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/_+$/, '')}`;
    rows.set(id, {
      id,
      name: `CIDRAP — ${topic}`,
      type: 'rss',
      url: `https://www.cidrap.umn.edu/news/${feedId}/rss`,
      fetch_strategy: 'rss',
      parser_hint: 'rss',
      priority_boost: boost,
      fetch_interval_hours: 6,
      tags: ['health-surveillance', 'cidrap'],
      config: {},
      enabled: true,
      disabled_reason: null,
      category: 'biological',
    });
  }
  rows.delete('CIDRAP');

  const all = [...rows.values()];
  const enabled = all.filter((r) => r.enabled);

  console.log(`sources in registry : ${all.length}`);
  console.log(`  enabled           : ${enabled.length}`);
  console.log(`  disabled          : ${all.length - enabled.length}`);
  console.log('\nby fetch strategy (enabled only):');
  const byStrategy = enabled.reduce((a, r) => ({ ...a, [r.fetch_strategy]: (a[r.fetch_strategy] || 0) + 1 }), {});
  Object.entries(byStrategy).forEach(([k, v]) => console.log(`  ${k.padEnd(10)} ${v}`));
  console.log('\ndisabled, with reason:');
  all.filter((r) => !r.enabled).forEach((r) => console.log(`  ${r.id.padEnd(24)} ${r.disabled_reason}`));

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to execute.');
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    for (const r of all) {
      await tx`
        INSERT INTO surveillance_sources ${tx(r, 'id', 'name', 'type', 'url', 'category', 'enabled',
          'fetch_interval_hours', 'fetch_strategy', 'parser_hint', 'priority_boost', 'tags', 'config', 'disabled_reason')}
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, type = EXCLUDED.type, url = EXCLUDED.url,
          enabled = EXCLUDED.enabled, fetch_interval_hours = EXCLUDED.fetch_interval_hours,
          fetch_strategy = EXCLUDED.fetch_strategy, parser_hint = EXCLUDED.parser_hint,
          priority_boost = EXCLUDED.priority_boost, tags = EXCLUDED.tags,
          config = EXCLUDED.config, disabled_reason = EXCLUDED.disabled_reason,
          updated_at = now()
      `;
      await tx`
        INSERT INTO source_snapshots (source_id) VALUES (${r.id})
        ON CONFLICT (source_id) DO NOTHING
      `;
    }
  });

  // Entries left over from the old hardcoded seeding, superseded by the merged
  // registry above. They are retired rather than deleted because radar_events
  // rows still reference some of them by foreign key.
  const known = [...rows.keys()];
  const retired = await sql`
    UPDATE surveillance_sources
    SET enabled = false,
        disabled_reason = 'Retired — superseded by the merged source registry (migration 003)',
        updated_at = now()
    WHERE id NOT IN ${sql(known)} AND disabled_reason IS DISTINCT FROM 'Retired — superseded by the merged source registry (migration 003)'
    RETURNING id
  `;
  if (retired.length) console.log(`\nretired legacy entries: ${retired.map((r) => r.id).join(', ')}`);

  const [{ n }] = await sql`SELECT count(*)::int AS n FROM surveillance_sources`;
  const [{ n: active }] = await sql`SELECT count(*)::int AS n FROM surveillance_sources WHERE enabled`;
  const [{ n: snaps }] = await sql`SELECT count(*)::int AS n FROM source_snapshots`;
  console.log(`\nregistry rows : ${n} (${active} enabled)`);
  console.log(`snapshot rows : ${snaps}`);
  console.log('\nMigration 003 complete.');
} finally {
  await sql.end();
}
