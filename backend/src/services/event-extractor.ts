import Anthropic from '@anthropic-ai/sdk';
import type { CountBasis, EpiIndicators } from './signal-scoring';

/**
 * Structured extraction of outbreak events from raw source content.
 *
 * This replaces the per-source title scrapers, which had no way to tell an
 * outbreak headline from page furniture — the naive extractor was recording
 * ECDC rows titled "Main Navigation (desktop)" as surveillance events.
 *
 * Division of responsibility is deliberate: the model extracts *facts* it can
 * read off the page (disease, place, counts, dates), and risk classification
 * stays in deterministic code. A public health authority needs to be able to
 * explain why something was rated Critical, and "the model decided" is not an
 * explanation an epidemiologist can defend.
 */

export interface ExtractedEvent {
    title: string;
    disease: string;
    country: string;
    dateReported: string | null;
    cases: number | null;
    deaths: number | null;
    /** What span the counts cover. See CountBasis — scoring depends on this. */
    countBasis?: CountBasis;
    /** The reporting window as the source words it, e.g. "since 2012", "week 31". */
    countPeriod?: string | null;
    summary: string;
    url: string | null;
    isOutbreakEvent: boolean;
    indicators?: EpiIndicators;
}

export interface ExtractionOutcome {
    events: ExtractedEvent[];
    status: 'ok' | 'no_key' | 'refusal' | 'error';
    detail: string;
    inputTokens?: number;
    outputTokens?: number;
    /** Which model ran, for cost accounting. */
    model?: string;
    /** Feed entries skipped as already-read or not health-related. */
    itemsSkipped?: number;
    /** Identities of the feed entries actually sent, so they are not sent twice. */
    presentedItems?: string[];
}

const EXTRACTION_SCHEMA = {
    type: 'object',
    properties: {
        events: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    title: {
                        type: 'string',
                        description: 'The headline as published, cleaned of site navigation text. Max 300 characters.',
                    },
                    disease: {
                        type: 'string',
                        description:
                            'The disease or pathogen named. Use the common English name (Cholera, Mpox, MERS-CoV, H5N1). Use "Unspecified" if the item is health-related but names no specific disease.',
                    },
                    country: {
                        type: 'string',
                        description:
                            'The country the event occurs in, in English. Use "Global" for worldwide or multi-region items with no single focus.',
                    },
                    dateReported: {
                        type: ['string', 'null'],
                        description: 'Publication or report date as YYYY-MM-DD. Null if the page states no date.',
                    },
                    cases: {
                        type: ['integer', 'null'],
                        description: 'Confirmed or reported case count if stated. Null if not stated. Never estimate.',
                    },
                    deaths: {
                        type: ['integer', 'null'],
                        description: 'Reported deaths if stated. Null if not stated. Never estimate.',
                    },
                    countBasis: {
                        type: 'string',
                        enum: ['outbreak_to_date', 'period', 'historical_cumulative', 'unknown'],
                        description:
                            'What span the case and death numbers cover. "outbreak_to_date" = the running total for THIS outbreak or event since it began. "period" = cases occurring within a stated reporting window such as a week, month, or year. "historical_cumulative" = an all-time or multi-year surveillance total that is not tied to a current outbreak, e.g. "2,226 cases reported globally since 2012". "unknown" if the text does not make it clear. Use "unknown" rather than guessing.',
                    },
                    countPeriod: {
                        type: ['string', 'null'],
                        description:
                            'The reporting window exactly as the source words it, e.g. "since 2012", "epidemiological week 31", "1 January to 30 June 2026". Null if the source states no window. Max 80 characters.',
                    },
                    summary: {
                        type: 'string',
                        description: 'One or two sentences describing what happened, drawn only from the source text. Max 400 characters.',
                    },
                    url: {
                        type: ['string', 'null'],
                        description: 'Absolute URL of the item if one appears in the content. Null otherwise.',
                    },
                    isOutbreakEvent: {
                        type: 'boolean',
                        description:
                            'True only for a specific disease event, outbreak, alert, or surveillance report. False for navigation, cookie notices, generic policy pages, job postings, event announcements, or anything that is not a health event.',
                    },
                    indicators: {
                        type: 'object',
                        description:
                            'Epidemiological indicators, each true ONLY if the source text explicitly states it. These feed a deterministic risk score, so a false positive here inflates a real escalation — when in doubt, say false.',
                        properties: {
                            novelPathogen: { type: 'boolean', description: 'A new pathogen, new subtype, or previously unknown agent.' },
                            outsideKnownRange: { type: 'boolean', description: 'The disease is occurring outside its established geographic range.' },
                            unusualPresentation: { type: 'boolean', description: 'Atypical clinical presentation, unusual severity, or unexpected season.' },
                            humanToHuman: { type: 'boolean', description: 'Human-to-human transmission is reported, suspected, or sustained.' },
                            healthcareWorkerInfections: { type: 'boolean', description: 'Healthcare workers among the cases.' },
                            multiCountry: { type: 'boolean', description: 'Cases reported in more than one country.' },
                            travelRestrictions: { type: 'boolean', description: 'Travel advisories, border measures, or trade restrictions announced or advised.' },
                            healthSystemStrain: { type: 'boolean', description: 'Hospitals or health services described as overwhelmed or strained.' },
                            vulnerableGroups: { type: 'boolean', description: 'Children, pregnant women, elderly, immunocompromised, refugees or displaced people specifically affected.' },
                            antimicrobialResistance: { type: 'boolean', description: 'A new or notable antimicrobial resistance profile.' },
                        },
                        required: [
                            'novelPathogen', 'outsideKnownRange', 'unusualPresentation', 'humanToHuman',
                            'healthcareWorkerInfections', 'multiCountry', 'travelRestrictions',
                            'healthSystemStrain', 'vulnerableGroups', 'antimicrobialResistance',
                        ],
                        additionalProperties: false,
                    },
                },
                required: ['title', 'disease', 'country', 'dateReported', 'cases', 'deaths', 'countBasis', 'countPeriod', 'summary', 'url', 'isOutbreakEvent', 'indicators'],
                additionalProperties: false,
            },
        },
    },
    required: ['events'],
    additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You extract disease outbreak events from public health agency web pages and feeds for a national health authority's surveillance system.

Extract only what the source text actually states. Do not infer case counts, dates, or countries that are not written on the page, and never estimate a number — report null instead. If a page contains no disease events at all, return an empty array; that is a correct and expected answer, not a failure.

Case and death numbers are meaningless without knowing what span they cover, so countBasis matters as much as the numbers themselves. WHO's MERS page reports 2,226 cases in Saudi Arabia since 2012; read as new cases that would look like a national emergency, read correctly it is fourteen years of routine surveillance. Set countBasis to historical_cumulative whenever the total spans years or is described as a running global or national tally, and to outbreak_to_date only when the figure belongs to one identifiable current event.

Mark isOutbreakEvent false for anything that is not a specific health event: site navigation, menus, cookie or privacy notices, search boxes, pagination, generic landing-page copy, job vacancies, conference announcements, and funding or administrative news. These appear frequently in scraped page content and must not become surveillance signals.`;

/**
 * Keeps only the most recent items of a feed. CDC's newsroom RSS carries 1,835
 * entries; asking for an event per entry overran the output token ceiling and
 * came back as truncated JSON. Feeds are ordered newest-first and anything
 * older than the retrospective window is discarded downstream anyway, so
 * trimming here costs no signal.
 */
export function trimFeedItems(xml: string, maxItems = 40): string {
    const opens = [...xml.matchAll(/<item[\s>]/gi)];
    if (opens.length <= maxItems) return xml;

    const cutFrom = opens[maxItems].index;
    if (cutFrom === undefined) return xml;

    const closingTag = xml.lastIndexOf('</channel>') >= 0 ? '</channel></rss>' : '';
    return `${xml.slice(0, cutFrom)}${closingTag}`;
}

/**
 * Extraction model.
 *
 * Reading "which disease, which country, how many cases" out of cleaned text is
 * not a frontier-model task, and running one over every source on every scan is
 * where the cost went: 34 sources at roughly 10k input tokens each is ~$3 a pass
 * on Opus, or about $1,000/month on a two-hourly cron.
 *
 * Haiku is 5x cheaper on both directions and does this job. A source that
 * genuinely needs more can set `config.model` in the registry — WHO EMRO was
 * the case that justified keeping a stronger model available, since a weaker
 * one merged the Saudi-specific MERS figures into the global total, and for a
 * Saudi health authority that is the row that matters.
 */
export const DEFAULT_EXTRACTION_MODEL = 'claude-haiku-4-5';

/**
 * Terms that make an item worth a model call.
 *
 * A deliberately generous net applied to feed items before extraction: it costs
 * nothing to run, and the model still decides what is a real event. The point
 * is only to avoid paying to be told that a press release about a building
 * opening is not an outbreak. Anything ambiguous is kept — a false negative
 * here is a missed signal, which is far more expensive than a wasted token.
 */
const RELEVANCE_TERMS = [
    'outbreak', 'case', 'cases', 'death', 'deaths', 'infect', 'disease', 'virus', 'viral',
    'bacter', 'epidemic', 'pandemic', 'cluster', 'surveillance', 'transmission', 'vaccine',
    'vaccination', 'immuni', 'fever', 'influenza', 'flu', 'cholera', 'measles', 'polio',
    'ebola', 'mpox', 'monkeypox', 'malaria', 'dengue', 'zika', 'covid', 'sars', 'mers',
    'coronavirus', 'hepatitis', 'meningit', 'diphther', 'pertussis', 'rabies', 'plague',
    'anthrax', 'botulism', 'salmonell', 'listeri', 'e. coli', 'coli', 'norovirus', 'rotavirus',
    'tuberculosis', 'hiv', 'aids', 'yellow fever', 'chikungunya', 'nipah', 'lassa', 'marburg',
    'hantavirus', 'legionell', 'typhoid', 'shigell', 'campylobact', 'brucell', 'leptospir',
    'schistosom', 'trachoma', 'leishman', 'trypanosom', 'poison', 'contaminat', 'foodborne',
    'waterborne', 'zoonotic', 'avian', 'h5n1', 'h7n9', 'h9n2', 'antimicrobial', 'resistance',
    'quarantine', 'epidemiolog', 'morbidit', 'mortalit', 'health emergency', 'public health',
    'who', 'alert', 'notifiable', 'screwworm', 'cyclospor', 'illness', 'sick', 'hospitali',
];

export function looksRelevant(text: string): boolean {
    const t = text.toLowerCase();
    return RELEVANCE_TERMS.some((term) => t.includes(term));
}

/**
 * Splits a feed into individual items so each can be hashed and skipped once
 * seen.
 *
 * This is the change that actually moves the bill. Page-level hashing means one
 * new headline on a forty-item feed re-extracts all forty, every time, and
 * busy sources change most scans. Feeds are structured enough to split for
 * free, so the model only ever sees entries the system has not already read.
 */
export function splitFeedIntoItems(xml: string): string[] {
    const matches = [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)];
    return matches.map((m) => m[0]);
}

/** Stable identity for a feed item: its guid or link, else the whole entry. */
export function itemIdentity(item: string): string {
    const guid = item.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1]
        ?? item.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]
        ?? item.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1];
    const key = (guid ?? item).replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    return key.slice(0, 500);
}

/**
 * Splits content into two halves for a retry after a truncated response.
 *
 * Feeds split on an item boundary so neither half cuts an entry down the
 * middle; anything else splits on the nearest newline. The halves are fed to
 * the model as text and never parsed as XML, so a missing wrapper element does
 * not matter — what matters is that no entry is destroyed by the cut.
 */
export function splitContent(content: string): [string, string] | null {
    const opens = [...content.matchAll(/<item[\s>]/gi)];
    if (opens.length >= 4) {
        const cut = opens[Math.floor(opens.length / 2)].index;
        if (cut !== undefined) return [content.slice(0, cut), content.slice(cut)];
    }

    if (content.length < 2000) return null;
    const mid = Math.floor(content.length / 2);
    const boundary = content.indexOf('\n', mid);
    const cut = boundary === -1 ? mid : boundary;
    return [content.slice(0, cut), content.slice(cut)];
}

/** Reduces an HTML page to readable text so the model reads content, not markup. */
export function htmlToText(html: string, maxChars = 40000): string {
    const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        // Navigation chrome is where the old title scraper found most of its
        // false events ("Main Navigation (desktop)", "Public health topics").
        // Removing it up front cuts tokens and removes the confusion at source.
        .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
        .replace(/<header[\s\S]*?<\/header>/gi, ' ')
        .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
        .replace(/<form[\s\S]*?<\/form>/gi, ' ')
        .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
        .replace(/<select[\s\S]*?<\/select>/gi, ' ')
        // Keep block boundaries so headlines stay separated after tag removal.
        .replace(/<\/(p|div|li|h[1-6]|tr|article|section)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n\s*\n+/g, '\n\n')
        .trim();

    return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n[content truncated]` : text;
}

/**
 * Extracts events from one source's content. Returns a `no_key` outcome rather
 * than throwing when no API key is configured, so the collector can fall back
 * to the legacy extractor instead of the scan failing.
 */
export async function extractEvents(
    apiKey: string | undefined,
    source: { id: string; name: string; url: string; config?: unknown },
    rawContent: string,
    isHtml: boolean,
    /** Item identities already extracted from this source; skipped if given. */
    seenItems?: Set<string>
): Promise<ExtractionOutcome> {
    if (!apiKey) {
        return { events: [], status: 'no_key', detail: 'ANTHROPIC_API_KEY is not configured' };
    }

    const model = (source.config as { model?: string } | undefined)?.model || DEFAULT_EXTRACTION_MODEL;

    let content: string;
    let skipped = 0;
    let presentedItems: string[] | undefined;

    if (isHtml) {
        content = htmlToText(rawContent);
    } else {
        // Feed path: drop entries already read, and entries with no health
        // vocabulary at all, before spending anything on them.
        const items = splitFeedIntoItems(rawContent);
        if (items.length === 0) {
            content = trimFeedItems(rawContent).slice(0, 40000);
        } else {
            const fresh: string[] = [];
            const presented: string[] = [];
            for (const item of items) {
                if (seenItems?.has(itemIdentity(item))) { skipped++; continue; }
                if (!looksRelevant(item)) { skipped++; continue; }
                fresh.push(item);
                presented.push(itemIdentity(item));
                if (fresh.length >= 40) break;
            }
            if (fresh.length === 0) {
                return {
                    events: [],
                    status: 'ok',
                    detail: `no new items (${skipped} already read or not health-related)`,
                    inputTokens: 0,
                    outputTokens: 0,
                    model,
                    itemsSkipped: skipped,
                };
            }
            content = fresh.join('\n').slice(0, 40000);
            presentedItems = presented;
        }
    }

    if (content.trim().length < 40) {
        return { events: [], status: 'ok', detail: 'source content was empty after cleaning' };
    }

    const outcome = await extractFromContent(apiKey, source, content, 0, model);
    return { ...outcome, model, itemsSkipped: skipped, presentedItems };
}

/** How many times a truncated response may be halved and retried. */
const MAX_SPLIT_DEPTH = 2;

/**
 * One extraction attempt, halving and retrying if the response is truncated.
 *
 * Raising max_tokens alone only moves the cliff — CDC's newsroom feed is
 * event-dense enough that some pass will always overrun it, and a source that
 * silently drops its content on a busy week is worse than one that costs an
 * extra call. Splitting bounds the work instead: at most four requests, and the
 * failure mode becomes "more requests" rather than "no events".
 */
async function extractFromContent(
    apiKey: string,
    source: { id: string; name: string; url: string },
    content: string,
    depth: number,
    model: string
): Promise<ExtractionOutcome> {

    const client = new Anthropic({ apiKey });

    try {
        const response = await client.messages.create({
            model,
            max_tokens: 16000,
            system: SYSTEM_PROMPT,
            // Effort is left at the default deliberately. Dropping it to 'low'
            // cut cost ~27% but lost rows that matter: it stopped splitting a
            // multi-country outbreak into one row per country, and dropped the
            // Saudi-Arabia-specific MERS figures in favour of the global total.
            // For a Saudi health authority that is the single most valuable row
            // on the page, so the saving is not worth taking.
            output_config: { format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
            messages: [
                {
                    role: 'user',
                    content: `Source: ${source.name} (${source.url})\n\nExtract every disease outbreak event described in the content below.\n\n---\n${content}`,
                },
            ],
        });

        // Safety classifiers can decline; health-surveillance content is benign
        // but sits adjacent to a restricted domain, so check before reading.
        if (response.stop_reason === 'refusal') {
            return {
                events: [],
                status: 'refusal',
                detail: `Extraction declined by safety classifier for ${source.id}`,
            };
        }

        // A truncated response is not a model failure and should not be reported
        // as a parse error — the JSON is valid up to the cut, it just ends
        // mid-string. Say so plainly so the fix is obvious.
        if (response.stop_reason === 'max_tokens') {
            const halves = depth < MAX_SPLIT_DEPTH ? splitContent(content) : null;
            if (!halves) {
                return {
                    events: [],
                    status: 'error',
                    detail: `Output truncated at max_tokens for ${source.id} and the content could not be split further`,
                    inputTokens: response.usage?.input_tokens,
                    outputTokens: response.usage?.output_tokens,
                };
            }

            const [first, second] = await Promise.all([
                extractFromContent(apiKey, source, halves[0], depth + 1, model),
                extractFromContent(apiKey, source, halves[1], depth + 1, model),
            ]);

            // A half that fails does not discard the half that worked; the
            // partial result is reported with the reason it is partial.
            const events = [...first.events, ...second.events];
            const failed = [first, second].filter((r) => r.status !== 'ok');
            return {
                events,
                status: failed.length === 2 ? 'error' : 'ok',
                detail: failed.length
                    ? `Split after truncation; ${failed.length} of 2 halves failed (${failed.map((f) => f.detail).join('; ')})`
                    : `Split after truncation into 2 halves`,
                inputTokens: (first.inputTokens ?? 0) + (second.inputTokens ?? 0),
                outputTokens: (first.outputTokens ?? 0) + (second.outputTokens ?? 0),
            };
        }

        const textBlock = response.content.find((b: any) => b.type === 'text') as any;
        if (!textBlock) {
            return { events: [], status: 'error', detail: 'Model returned no text block' };
        }

        const parsed = JSON.parse(textBlock.text);
        const events: ExtractedEvent[] = (parsed.events ?? []).filter((e: ExtractedEvent) => e.isOutbreakEvent);

        return {
            events,
            status: 'ok',
            detail: `${events.length} of ${parsed.events?.length ?? 0} items were outbreak events`,
            inputTokens: response.usage?.input_tokens,
            outputTokens: response.usage?.output_tokens,
        };
    } catch (err: any) {
        return { events: [], status: 'error', detail: err?.message || 'Extraction request failed' };
    }
}
