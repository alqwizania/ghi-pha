/**
 * X (Twitter) ingestion for the social listener.
 *
 * X moved to credit-based pay-per-usage: $0.005 per post read, $0.010 per user
 * read, no subscription and no minimum spend, capped at 2M post reads a month.
 * That changes the economics completely — the old Basic tier was $200/month
 * before a single useful post — but it also means every design decision here is
 * a spending decision, so the cost reasoning is written down beside the code.
 *
 * Four rules keep this cheap:
 *
 * 1. **Resolve handles to IDs once.** User reads cost twice what post reads do
 *    and a numeric ID never changes. Resolving 12 handles costs $0.12 exactly
 *    once; doing it on every poll would cost more than the posts.
 *
 * 2. **Poll timelines, never search.** A timeline read returns only that
 *    account's posts. Keyword search across all of X returns — and bills for —
 *    everything that matched, most of which is noise the keyword filter would
 *    discard anyway.
 *
 * 3. **Lean on the 24-hour deduplication window.** X charges once per resource
 *    per day however many times it is requested, so polling frequency is nearly
 *    free; cost tracks *unique posts published*, not how often we look. Polling
 *    hourly costs the same as polling six-hourly, and catches things sooner.
 *
 * 4. **Do not pay for what the radar already has.** Eight of the twelve
 *    monitored accounts are official agencies — @WHO, @CDCgov, @SaudiMOH,
 *    @WHOEMRO, @ProMED_mail — whose posts are links to pages GHI already
 *    collects for free, and the page usually goes up before the tweet. They are
 *    marked redundant in the registry rather than polled. What X uniquely
 *    offers is the expert and local-news commentary that never becomes a press
 *    release.
 *
 * A hard budget cap sits in front of all of it. A surveillance system that
 * quietly drains a prepaid balance is worse than one that stops and says so.
 */

import type { EpiIndicators } from './signal-scoring';

const API = 'https://api.x.com/2';

/** USD per resource, from X's published pay-per-usage rates. */
export const POST_READ_COST = 0.005;
export const USER_READ_COST = 0.010;

export interface XAccount {
    handle: string;
    /** Numeric X user id. Cached after first resolution; never changes. */
    userId?: string | null;
    accountType: string;
    priority: number;
}

export interface XPost {
    postId: string;
    authorHandle: string;
    text: string;
    lang: string | null;
    createdAt: string;
    engagement: { likes: number; retweets: number; replies: number };
    urls: string[];
    hashtags: string[];
}

export interface FetchOutcome {
    posts: XPost[];
    /** Resources billed this call, for the spend ledger. */
    postReads: number;
    userReads: number;
    estimatedCost: number;
    status: 'ok' | 'no_key' | 'budget_exhausted' | 'rate_limited' | 'error';
    detail: string;
}

const empty = (status: FetchOutcome['status'], detail: string): FetchOutcome => ({
    posts: [], postReads: 0, userReads: 0, estimatedCost: 0, status, detail,
});

/**
 * Resolves handles to numeric ids.
 *
 * Kept separate from post fetching precisely so it can be called rarely. The
 * caller is expected to persist the result; if this runs on every poll the
 * listener costs twice what it should for no added signal.
 */
export async function resolveUserIds(
    bearerToken: string | undefined,
    handles: string[]
): Promise<{ ids: Record<string, string>; userReads: number; cost: number; detail: string }> {
    if (!bearerToken) return { ids: {}, userReads: 0, cost: 0, detail: 'X_BEARER_TOKEN is not configured' };
    if (handles.length === 0) return { ids: {}, userReads: 0, cost: 0, detail: 'no handles to resolve' };

    const clean = handles.map((h) => h.replace(/^@/, '')).slice(0, 100);
    const url = `${API}/users/by?usernames=${encodeURIComponent(clean.join(','))}`;

    try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${bearerToken}` } });
        if (!res.ok) {
            return { ids: {}, userReads: 0, cost: 0, detail: `HTTP ${res.status} resolving handles` };
        }
        const body = await res.json() as { data?: Array<{ id: string; username: string }> };
        // Keyed lowercase: X returns its own canonical capitalisation, which
        // rarely matches how a handle was typed into the registry. An exact
        // match dropped accounts that had in fact resolved successfully.
        const ids: Record<string, string> = {};
        for (const u of body.data ?? []) ids[`@${u.username}`.toLowerCase()] = u.id;
        const userReads = body.data?.length ?? 0;
        return {
            ids,
            userReads,
            cost: userReads * USER_READ_COST,
            detail: `resolved ${userReads} of ${clean.length} handles`,
        };
    } catch (err) {
        return { ids: {}, userReads: 0, cost: 0, detail: `network error: ${String(err)}` };
    }
}

/**
 * Fetches recent posts for one account.
 *
 * `sinceId` is the cheapest control available: X returns only posts newer than
 * it, so a quiet account costs nothing at all rather than re-billing its last
 * ten posts on every pass.
 */
export async function fetchAccountPosts(
    bearerToken: string | undefined,
    account: XAccount,
    sinceId: string | null,
    maxResults = 20
): Promise<FetchOutcome> {
    if (!bearerToken) return empty('no_key', 'X_BEARER_TOKEN is not configured');
    if (!account.userId) return empty('error', `no cached user id for ${account.handle}; resolve handles first`);

    const params = new URLSearchParams({
        max_results: String(Math.min(100, Math.max(5, maxResults))),
        'tweet.fields': 'created_at,lang,public_metrics,entities',
        exclude: 'retweets,replies',
    });
    if (sinceId) params.set('since_id', sinceId);

    try {
        const res = await fetch(`${API}/users/${account.userId}/tweets?${params}`, {
            headers: { Authorization: `Bearer ${bearerToken}` },
        });

        if (res.status === 429) return empty('rate_limited', 'rate limited by X');
        if (res.status === 402) return empty('budget_exhausted', 'X credit balance exhausted');
        if (!res.ok) return empty('error', `HTTP ${res.status} fetching ${account.handle}`);

        const body = await res.json() as {
            data?: Array<any>;
            meta?: { result_count?: number };
        };
        const raw = body.data ?? [];
        const posts: XPost[] = raw.map((t) => ({
            postId: t.id,
            authorHandle: account.handle,
            text: t.text ?? '',
            lang: t.lang ?? null,
            createdAt: t.created_at ?? new Date().toISOString(),
            engagement: {
                likes: t.public_metrics?.like_count ?? 0,
                retweets: t.public_metrics?.retweet_count ?? 0,
                replies: t.public_metrics?.reply_count ?? 0,
            },
            urls: (t.entities?.urls ?? []).map((u: any) => u.expanded_url ?? u.url).filter(Boolean),
            hashtags: (t.entities?.hashtags ?? []).map((h: any) => h.tag).filter(Boolean),
        }));

        return {
            posts,
            postReads: posts.length,
            userReads: 0,
            estimatedCost: posts.length * POST_READ_COST,
            status: 'ok',
            detail: posts.length === 0 ? 'no new posts' : `${posts.length} new posts`,
        };
    } catch (err) {
        return empty('error', `network error for ${account.handle}: ${String(err)}`);
    }
}

/**
 * Health relevance for a post.
 *
 * Applied after fetching because X bills on read, not on what we keep — there
 * is no saving in filtering earlier. Its job is to stop irrelevant posts
 * reaching the triage queue, not to reduce spend.
 */
const HEALTH_TERMS = [
    'outbreak', 'epidemic', 'pandemic', 'case', 'cases', 'death', 'deaths', 'infect', 'virus',
    'disease', 'fever', 'flu', 'influenza', 'cholera', 'measles', 'polio', 'ebola', 'mpox',
    'covid', 'mers', 'sars', 'dengue', 'malaria', 'hepatitis', 'meningitis', 'cluster',
    'quarantine', 'vaccine', 'health emergency', 'who', 'surveillance', 'transmission',
    // Arabic — the Saudi and regional accounts post primarily in Arabic, and an
    // English-only filter would silence exactly the accounts nearest the Kingdom.
    'وباء', 'تفشي', 'إصابة', 'إصابات', 'وفاة', 'وفيات', 'فيروس', 'مرض', 'حمى', 'أنفلونزا',
    'كوليرا', 'حصبة', 'شلل الأطفال', 'إيبولا', 'جدري', 'كورونا', 'حجر صحي', 'لقاح',
    'صحة', 'منظمة الصحة', 'انتشار', 'عدوى', 'مستشفى', 'طوارئ',
];

export function isHealthRelated(text: string): boolean {
    const t = text.toLowerCase();
    return HEALTH_TERMS.some((term) => t.includes(term));
}

/**
 * Estimates the monthly bill for a set of accounts.
 *
 * Deliberately driven by posts published rather than poll frequency, because
 * the 24-hour deduplication window means those are different things and getting
 * it backwards is what makes people over-provision.
 */
export function estimateMonthlyCost(
    accounts: number,
    avgPostsPerAccountPerDay: number,
    handleResolutionsPerMonth = 1
): { posts: number; postCost: number; userCost: number; total: number } {
    const posts = accounts * avgPostsPerAccountPerDay * 30;
    const postCost = posts * POST_READ_COST;
    const userCost = accounts * handleResolutionsPerMonth * USER_READ_COST;
    return { posts, postCost, userCost, total: postCost + userCost };
}
