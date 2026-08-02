import Anthropic from '@anthropic-ai/sdk';
import type { EpiIndicators } from './signal-scoring';

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
                required: ['title', 'disease', 'country', 'dateReported', 'cases', 'deaths', 'summary', 'url', 'isOutbreakEvent', 'indicators'],
                additionalProperties: false,
            },
        },
    },
    required: ['events'],
    additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You extract disease outbreak events from public health agency web pages and feeds for a national health authority's surveillance system.

Extract only what the source text actually states. Do not infer case counts, dates, or countries that are not written on the page, and never estimate a number — report null instead. If a page contains no disease events at all, return an empty array; that is a correct and expected answer, not a failure.

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
    source: { id: string; name: string; url: string },
    rawContent: string,
    isHtml: boolean
): Promise<ExtractionOutcome> {
    if (!apiKey) {
        return { events: [], status: 'no_key', detail: 'ANTHROPIC_API_KEY is not configured' };
    }

    const content = isHtml ? htmlToText(rawContent) : trimFeedItems(rawContent).slice(0, 40000);
    if (content.trim().length < 40) {
        return { events: [], status: 'ok', detail: 'source content was empty after cleaning' };
    }

    const client = new Anthropic({ apiKey });

    try {
        const response = await client.messages.create({
            model: 'claude-opus-5',
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
            return {
                events: [],
                status: 'error',
                detail: `Output truncated at max_tokens for ${source.id}; the source has more items than one response can carry`,
                inputTokens: response.usage?.input_tokens,
                outputTokens: response.usage?.output_tokens,
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
