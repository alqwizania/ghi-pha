/**
 * Migration 021 — the PHA keyword list, English and Arabic.
 *
 * From "KEY WORDS.docx" in the inherited project. These are the terms PHA
 * actually watches for, which is a different and better list than one derived
 * from disease names: it is built around *what an emerging event looks like
 * before anyone has named the pathogen*. "Mystery illness", "unusual increase",
 * "hospital overload" and "mass deaths" are how a novel outbreak reads in the
 * first 48 hours, when the disease field would still be Unspecified.
 *
 * Every term carries an Arabic equivalent. Regional accounts nearest the
 * Kingdom post primarily in Arabic, so an English-only list would be blindest
 * exactly where the Kingdom is most exposed. The Arabic is not a literal
 * translation in every case — it is the phrasing Gulf health reporting actually
 * uses, which is what a matcher needs.
 *
 * Priority follows how much an analyst should drop to look:
 *   1  the event is already unusual or unexplained — the strongest early signal
 *   2  scale or system strain is being described
 *   3  generic alerting vocabulary, useful only in combination
 *
 * Also reactivates every monitored account. An earlier migration deactivated
 * the six whose content the radar already collects; PHA's decision is to watch
 * all twelve on X regardless, since a ministry's own wording and timing on a
 * post carries information its website release does not.
 *
 * Usage:  node migrations/021_listener_keywords.mjs [--apply]
 */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APPLY = process.argv.includes('--apply');

// [english, arabic, category, priority]
const KEYWORDS = [
  ['outbreak', 'تفشي', 'severity', 1],
  ['cluster', 'تجمع حالات', 'severity', 1],
  ['epidemic', 'وباء', 'severity', 1],
  ['epidemic outbreak', 'تفشي وبائي', 'severity', 1],
  ['unusual increase', 'ارتفاع غير معتاد', 'severity', 1],
  ['sudden increase', 'ارتفاع مفاجئ', 'severity', 1],
  ['spike in cases', 'قفزة في الإصابات', 'severity', 1],
  ['mystery illness', 'مرض غامض', 'severity', 1],
  ['unknown disease', 'مرض مجهول', 'severity', 1],
  ['mass deaths', 'وفيات جماعية', 'severity', 1],
  ['unusual deaths', 'وفيات غير معتادة', 'severity', 1],
  ['hospital overload', 'اكتظاظ المستشفيات', 'severity', 2],
  ['overwhelmed hospitals', 'مستشفيات مثقلة', 'severity', 2],
  ['quarantine', 'حجر صحي', 'severity', 2],
  ['lockdown', 'إغلاق', 'severity', 2],
  ['hospitalized', 'دخول المستشفى', 'severity', 2],
  ['admission surge', 'ارتفاع حالات الدخول', 'severity', 2],
  ['death toll', 'حصيلة الوفيات', 'severity', 2],
  ['fatalities rising', 'ارتفاع الوفيات', 'severity', 2],
  ['detected', 'رصد', 'severity', 3],
  ['alert', 'تنبيه', 'severity', 3],
  ['surge', 'ارتفاع حاد', 'severity', 3],
  ['alarm', 'إنذار', 'severity', 3],
  ['declares', 'يعلن', 'severity', 3],
  ['warning', 'تحذير', 'severity', 3],
  ['exceeded', 'تجاوز', 'severity', 3],
];

function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const devVars = readFileSync(fileURLToPath(new URL('../.dev.vars', import.meta.url)), 'utf8');
  const match = devVars.match(/^DATABASE_URL=(.*)$/m);
  if (!match) throw new Error('DATABASE_URL not found in environment or .dev.vars');
  return match[1].trim().replace(/^"|"$/g, '');
}

const sql = postgres(connectionString(), { ssl: 'require' });

try {
  const [{ n: existing }] = await sql`SELECT count(*)::int AS n FROM listener_keywords`;
  const [{ n: inactive }] = await sql`SELECT count(*)::int AS n FROM monitored_accounts WHERE NOT is_active`;

  console.log(`keywords currently stored : ${existing}`);
  console.log(`keywords to seed          : ${KEYWORDS.length * 2} (${KEYWORDS.length} terms x en/ar)`);
  console.log(`accounts to reactivate    : ${inactive}`);
  console.log('\nby priority:');
  for (const p of [1, 2, 3]) {
    const terms = KEYWORDS.filter((k) => k[3] === p);
    console.log(`  ${p}: ${terms.length} — ${terms.slice(0, 4).map((t) => t[0]).join(', ')}${terms.length > 4 ? ' …' : ''}`);
  }

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to execute.');
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    // Pair each Arabic term with its English counterpart so a match in either
    // language reports the same concept rather than two unrelated hits.
    await tx`
      ALTER TABLE listener_keywords
        ADD COLUMN IF NOT EXISTS pair_key varchar(80)
    `;
    // The seed data already carried duplicates of the same term in the same
    // language, which is why the unique index could not be created until now.
    // Oldest row of each pair wins so any hand-edited priority survives.
    const deduped = await tx`
      DELETE FROM listener_keywords a
      USING listener_keywords b
      WHERE lower(a.keyword) = lower(b.keyword)
        AND a.language = b.language
        AND a.created_at > b.created_at
      RETURNING a.id`;
    if (deduped.length) console.log(`deduped : ${deduped.length} duplicate keyword rows`);

    await tx`
      CREATE UNIQUE INDEX IF NOT EXISTS listener_keywords_unique
      ON listener_keywords (lower(keyword), language)
    `;

    let seeded = 0;
    for (const [en, ar, category, priority] of KEYWORDS) {
      for (const [term, lang] of [[en, 'en'], [ar, 'ar']]) {
        await tx`
          INSERT INTO listener_keywords (keyword, category, language, priority, is_active, pair_key)
          VALUES (${term}, ${category}, ${lang}, ${priority}, true, ${en})
          ON CONFLICT (lower(keyword), language) DO UPDATE
            SET priority = ${priority}, category = ${category}, pair_key = ${en},
                is_active = true, updated_at = now()`;
        seeded++;
      }
    }
    console.log(`seeded  : ${seeded} keyword rows`);

    const reactivated = await tx`
      UPDATE monitored_accounts SET is_active = true, updated_at = now()
      WHERE NOT is_active RETURNING account_handle`;
    console.log(`enabled : ${reactivated.length} accounts (${reactivated.map((r) => r.account_handle).join(', ')})`);
  });

  const [{ n }] = await sql`SELECT count(*)::int AS n FROM monitored_accounts WHERE is_active`;
  console.log(`\nall ${n} monitored accounts active.`);
  console.log('Migration 021 complete.');
} finally {
  await sql.end();
}
