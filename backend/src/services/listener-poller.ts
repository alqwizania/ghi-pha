/**
 * The listener poll: X accounts in, scored social signals out.
 *
 * This is the second stream feeding triage. It differs from the radar in one
 * way that shapes everything else: a post is a *claim*, not a report. WHO's
 * event-based surveillance puts verification before risk assessment precisely
 * so a rumour cannot escalate on its own, so nothing here auto-promotes —
 * social signals reach triage as candidates and graduate only when a
 * registered source corroborates them.
 *
 * Cost discipline is inherited from x-listener.ts: ids resolved once, timelines
 * not search, `since_id` high-water marks, and a hard spend cap. Every poll
 * writes to `listener_spend` so the bill is visible before it arrives.
 */

import { eq } from 'drizzle-orm';
import { monitoredAccounts, socialSignals, listenerKeywords, listenerSpend } from '../db/schema';
import {
    fetchAccountPosts, resolveUserIds, isHealthRelated,
    POST_READ_COST, USER_READ_COST, type XAccount,
} from './x-listener';

export interface PollOptions {
    /** Stop once this much has been spent in one poll. */
    budgetUsd?: number;
    /** Posts requested per account per poll. */
    perAccount?: number;
}

export interface PollResult {
    status: 'ok' | 'no_key' | 'partial';
    accountsPolled: number;
    postsRead: number;
    signalsStored: number;
    userReads: number;
    costUsd: number;
    diagnostics: Record<string, string>;
}

/**
 * Keyword matching, in both languages.
 *
 * Terms are stored paired (`pair_key`), so an Arabic hit and its English
 * equivalent report the same concept rather than two unrelated matches — which
 * matters because relevance is scored on how many *distinct* concepts appear,
 * not how many strings did.
 */
export function matchKeywords(
    text: string,
    keywords: Array<{ keyword: string; pairKey: string | null; priority: number | null }>
): { concepts: string[]; topPriority: number } {
    const haystack = text.toLowerCase();
    const concepts = new Map<string, number>();

    for (const k of keywords) {
        const term = k.keyword.toLowerCase().trim();
        if (!term || !haystack.includes(term)) continue;
        const concept = k.pairKey || term;
        const priority = k.priority ?? 3;
        const existing = concepts.get(concept);
        if (existing === undefined || priority < existing) concepts.set(concept, priority);
    }

    return {
        concepts: [...concepts.keys()],
        topPriority: concepts.size ? Math.min(...concepts.values()) : 4,
    };
}

/**
 * Relevance, 0–100.
 *
 * Driven by which concepts matched rather than how many words did. PHA's list
 * is built around what an emerging event looks like *before anyone has named
 * the pathogen* — "mystery illness", "unusual increase", "mass deaths" — so a
 * priority-1 match is the strongest thing this stream produces, and a post full
 * of priority-3 alerting vocabulary is not.
 *
 * Account type is a modifier, not a driver: an official ministry saying
 * something unusual matters more than an influencer saying it, but an
 * influencer reporting a mystery illness still deserves a look.
 */
export function scoreRelevance(
    match: { concepts: string[]; topPriority: number },
    accountType: string,
    engagement: { likes: number; retweets: number },
    /** Passed the health-vocabulary filter without matching a watch term. */
    healthRelated = false
): number {
    if (match.concepts.length === 0 && !healthRelated) return 0;

    // A health post from a monitored account that matches no watch term is
    // still worth a low score rather than zero. WHO EMRO's Arabic posts landed
    // here — stored, but at relevance 0 they would never have surfaced, which
    // is indistinguishable from not collecting them at all.
    let score = match.concepts.length === 0
        ? 12
        : match.topPriority === 1 ? 60 : match.topPriority === 2 ? 40 : 20;
    if (match.concepts.length > 1) score += Math.min(20, (match.concepts.length - 1) * 7);

    if (accountType === 'official') score += 15;
    else if (accountType === 'expert') score += 10;

    // Reach is weak evidence that something is happening, capped low so a viral
    // post cannot outrank a quiet ministry statement.
    const reach = engagement.likes + engagement.retweets * 2;
    if (reach > 5000) score += 8;
    else if (reach > 500) score += 4;

    return Math.max(0, Math.min(100, score));
}

export async function pollListener(
    db: any,
    env: { X_BEARER_TOKEN?: string },
    options: PollOptions = {}
): Promise<PollResult> {
    const budget = options.budgetUsd ?? 2.0;
    const perAccount = options.perAccount ?? 20;
    const diagnostics: Record<string, string> = {};

    const token = env?.X_BEARER_TOKEN;
    if (!token) {
        return {
            status: 'no_key', accountsPolled: 0, postsRead: 0, signalsStored: 0,
            userReads: 0, costUsd: 0,
            diagnostics: { LISTENER: 'X_BEARER_TOKEN is not configured' },
        };
    }

    const accounts = await db.query.monitoredAccounts.findMany({
        where: eq(monitoredAccounts.isActive, true),
    });
    const keywords = await db.query.listenerKeywords.findMany({
        where: eq(listenerKeywords.isActive, true),
    });

    // Resolve any handle we do not yet have an id for. This is the expensive
    // call and it should happen approximately once in the system's lifetime.
    const unresolved = accounts.filter((a: any) => !a.xUserId);
    let userReads = 0;
    let spent = 0;

    if (unresolved.length) {
        const resolved = await resolveUserIds(token, unresolved.map((a: any) => a.accountHandle));
        userReads = resolved.userReads;
        spent += resolved.cost;
        diagnostics.RESOLVE = resolved.detail;
        for (const a of unresolved) {
            const id = resolved.ids[String(a.accountHandle).toLowerCase()];
            if (!id) {
                diagnostics[a.accountHandle] = 'handle could not be resolved';
                continue;
            }
            a.xUserId = id;
            await db.update(monitoredAccounts)
                .set({ xUserId: id, updatedAt: new Date() })
                .where(eq(monitoredAccounts.id, a.id));
        }
    }

    // Highest priority first, so a budget cut-off drops the least important
    // accounts rather than whichever happened to sort last.
    const ordered = [...accounts]
        .filter((a: any) => a.xUserId)
        .sort((x: any, y: any) => (x.priority ?? 3) - (y.priority ?? 3));

    let accountsPolled = 0;
    let postsRead = 0;
    let signalsStored = 0;
    let hitBudget = false;

    for (const account of ordered) {
        if (spent >= budget) {
            hitBudget = true;
            diagnostics.BUDGET = `stopped after $${spent.toFixed(3)} of $${budget.toFixed(2)}`;
            break;
        }

        const spec: XAccount = {
            handle: account.accountHandle,
            userId: account.xUserId,
            accountType: account.accountType,
            priority: account.priority ?? 3,
        };

        const outcome = await fetchAccountPosts(token, spec, account.lastPostId ?? null, perAccount);
        accountsPolled++;
        postsRead += outcome.postReads;
        spent += outcome.estimatedCost;
        diagnostics[account.accountHandle] = outcome.detail;

        if (outcome.status === 'budget_exhausted') {
            diagnostics.BUDGET = 'X reports the credit balance is exhausted';
            hitBudget = true;
            break;
        }
        if (outcome.status !== 'ok') continue;

        let newestId = account.lastPostId ?? null;

        for (const post of outcome.posts) {
            if (!newestId || post.postId > newestId) newestId = post.postId;

            const match = matchKeywords(post.text, keywords);
            // A post from a monitored health account with no keyword hit and no
            // health vocabulary is not a signal. Recording it anyway would bury
            // the ones that are.
            if (match.concepts.length === 0 && !isHealthRelated(post.text)) continue;

            const relevance = scoreRelevance(match, account.accountType, post.engagement, isHealthRelated(post.text));

            try {
                await db.insert(socialSignals).values({
                    platform: 'x',
                    postId: post.postId,
                    author: account.accountName,
                    authorHandle: account.accountHandle,
                    content: post.text,
                    language: post.lang ?? 'en',
                    location: account.region,
                    hashtags: post.hashtags,
                    urls: post.urls,
                    engagement: post.engagement,
                    detectedKeywords: match.concepts,
                    relevanceScore: String(relevance),
                    // Never 'Verified' on arrival. A post is a claim; corroboration
                    // by a registered source is what graduates it.
                    verificationStatus: 'Pending',
                    postedAt: new Date(post.createdAt),
                }).onConflictDoNothing();
                signalsStored++;
            } catch (err) {
                console.error(`[GHI Listener] Could not store ${post.postId}:`, err);
            }
        }

        await db.update(monitoredAccounts)
            .set({
                lastPostId: newestId,
                lastPolledAt: new Date(),
                postsRead: (account.postsRead ?? 0) + outcome.postReads,
                updatedAt: new Date(),
            })
            .where(eq(monitoredAccounts.id, account.id));
    }

    const costUsd = postsRead * POST_READ_COST + userReads * USER_READ_COST;

    try {
        await db.insert(listenerSpend).values({
            platform: 'x',
            postReads: postsRead,
            userReads,
            costUsd: String(costUsd.toFixed(4)),
            accounts: accountsPolled,
            detail: hitBudget ? 'stopped on budget' : 'completed',
        });
    } catch (err) {
        console.error('[GHI Listener] Could not write spend ledger:', err);
    }

    console.log(
        `[GHI Listener] ${accountsPolled} accounts, ${postsRead} posts read, ` +
        `${signalsStored} signals stored, $${costUsd.toFixed(4)}`
    );

    return {
        status: hitBudget ? 'partial' : 'ok',
        accountsPolled, postsRead, signalsStored, userReads, costUsd, diagnostics,
    };
}
