/**
 * Automated first-pass assessment.
 *
 * When an analyst accepts a signal in triage, the system writes a complete IHR
 * Annex 2 answer set and RRA draft rather than an empty form. The analyst then
 * edits rather than composes, which is the difference between an assessment
 * queue that gets worked and one that gets postponed.
 *
 * Two properties matter more than the prose quality:
 *
 * 1. **The draft is frozen.** It is written once, to `machine_draft`, and never
 *    rewritten. The live assessment columns start as a copy. Analyst edits touch
 *    only the live columns, so any divergence between the two *is* the human
 *    override — no precedence flag, no "who wins" logic, and the original
 *    machine position stays on the record for audit.
 *
 * 2. **No model call happens here.** Every answer and every sentence below is
 *    derived from the deterministic domain scores in `signal-scoring.ts`. A
 *    health authority has to be able to explain why a draft said "notify WHO",
 *    and "the model judged it so" is not an explanation that survives review.
 *    The model's role stays where it was: reading facts out of source text.
 *
 * The draft is generated for every accepted signal that carries a score, not
 * only high-tier ones. An accepted signal has already cleared human triage, so
 * withholding a starting point from the moderate ones only creates blank forms.
 */

import { SCORER_VERSION, type CountBasis, type DomainScore, type ScoreResult } from './signal-scoring';

export const DRAFTER_VERSION = 'ihr-annex2-draft-v1';

export interface DraftInput {
    disease: string;
    country: string;
    cases: number | null;
    deaths: number | null;
    sourceName: string | null;
    dateReported: string | null;
    score: ScoreResult;
    scorerVersion?: string;
    /** What span the counts cover, surfaced to the analyst as an uncertainty. */
    countBasis?: CountBasis;
    countPeriod?: string | null;
}

export interface MachineDraft {
    drafterVersion: string;
    scorerVersion: string;
    generatedAt: string;
    tier: ScoreResult['tier'];
    ihr: {
        q1: boolean; q1Notes: string;
        q2: boolean; q2Notes: string;
        q3: boolean; q3Notes: string;
        q4: boolean; q4Notes: string;
        yesCount: number;
        /** Annex 2's always-notifiable list applies regardless of the four answers. */
        mandatoryIhr: boolean;
        decision: string;
        decisionRationale: string;
    };
    rra: {
        hazard: string;
        exposure: string;
        context: string;
        overallRisk: 'Low' | 'Moderate' | 'High' | 'Critical';
        confidenceLevel: 'High' | 'Medium' | 'Low';
        keyUncertainties: string[];
        recommendations: string[];
    };
}

/**
 * Joins scoring reasons into readable sentences, dropping any reason another
 * one already contains. Domains overlap by design — severity counts deaths and
 * the burden line names them too — so without this the hazard leg reads
 * "2,226 cases and 869 deaths reported. 869 deaths reported."
 */
function sentences(reasons: string[]): string {
    const kept: Array<{ text: string; norm: string }> = [];

    for (const raw of reasons) {
        const text = raw.trim();
        if (!text) continue;
        const norm = text.toLowerCase().replace(/[.!?]+$/, '');
        if (kept.some((k) => k.norm.includes(norm))) continue;
        for (let i = kept.length - 1; i >= 0; i--) {
            if (norm.includes(kept[i].norm)) kept.splice(i, 1);
        }
        kept.push({ text, norm });
    }

    return kept
        .map((k) => k.text.charAt(0).toUpperCase() + k.text.slice(1))
        .map((t) => (/[.!?]$/.test(t) ? t : `${t}.`))
        .join(' ');
}

/**
 * A domain's note.
 *
 * Where the domain found nothing, the note says so explicitly rather than
 * leaving a blank — "no indication in the reported information" is a defensible
 * Annex 2 answer; silence is not.
 *
 * Where the domain found something but not enough to cross the threshold, the
 * note has to say that. Otherwise a NO on international spread is justified by
 * the words "faecal-oral transmission route", which reads as an argument for
 * the opposite answer.
 */
function note(domain: DomainScore, yes: boolean, whenSilent: string): string {
    if (!domain.reasons.length) return whenSilent;
    if (yes) return sentences(domain.reasons);
    return `Below the Annex 2 threshold on the reported information. ${sentences(domain.reasons)}`;
}

/**
 * The burden sentence, qualified by what the counts actually cover. An
 * unqualified "2,226 cases and 869 deaths" is the misleading half of the MERS
 * problem even once scoring has stopped acting on it — the analyst reads this
 * line, not the score.
 */
function burden(input: DraftInput): string {
    const c = input.cases ?? 0;
    const d = input.deaths ?? 0;

    let core: string;
    if (c > 0 && d > 0) core = `${c} case${c === 1 ? '' : 's'} and ${d} death${d === 1 ? '' : 's'}`;
    else if (c > 0) core = `${c} case${c === 1 ? '' : 's'}, no deaths stated`;
    else if (d > 0) core = `${d} death${d === 1 ? '' : 's'}, case count not stated`;
    else return 'no case or death counts given in the source report';

    const window = input.countPeriod ? ` covering ${input.countPeriod}` : '';
    switch (input.countBasis) {
        case 'historical_cumulative':
            return `${core} reported as a cumulative historical total${window}, not current incidence`;
        case 'outbreak_to_date':
            return `${core} reported for this outbreak to date${window}`;
        case 'period':
            return `${core} reported${window || ' for the stated reporting period'}`;
        default:
            return `${core} reported; the source does not state what period this covers`;
    }
}

const RISK_BY_TIER: Record<ScoreResult['tier'], MachineDraft['rra']['overallRisk']> = {
    critical: 'Critical',
    high: 'High',
    moderate: 'Moderate',
    routine: 'Low',
};

const CONFIDENCE_LABEL: Record<ScoreResult['confidence'], MachineDraft['rra']['confidenceLevel']> = {
    high: 'High',
    medium: 'Medium',
    low: 'Low',
};

/**
 * Builds the draft.
 *
 * The four Annex 2 answers are the four IHR domains thresholded at 2 — the same
 * cut the triage tier already uses — so the draft cannot disagree with the score
 * that promoted the signal. Annex 2's own rule then applies: any two of four
 * yes means the event is notifiable.
 */
export function buildDraft(input: DraftInput, now: Date = new Date()): MachineDraft {
    const { score, disease, country } = input;
    const place = country || 'the reporting country';

    const q1 = score.severity.score >= 2;
    const q2 = score.unusualness.score >= 2;
    const q3 = score.spread.score >= 2;
    const q4 = score.tradeTravel.score >= 2;
    const yesCount = [q1, q2, q3, q4].filter(Boolean).length;

    let decision: string;
    let decisionRationale: string;
    if (score.mandatoryIhr) {
        decision = 'Notify WHO';
        decisionRationale =
            `${disease} is on the IHR Annex 2 always-notifiable list and the report describes an actual occurrence, ` +
            `so notification is required irrespective of how the four questions are answered.`;
    } else if (yesCount >= 2) {
        decision = 'Notify WHO';
        decisionRationale =
            `${yesCount} of the four Annex 2 questions are answered yes on the reported information. ` +
            `Annex 2 requires notification at two.`;
    } else if (yesCount === 1) {
        decision = 'Monitor and reassess';
        decisionRationale =
            `One Annex 2 question is answered yes, which is below the notification threshold of two. ` +
            `Reassess if further information changes any remaining answer.`;
    } else {
        decision = 'No notification indicated';
        decisionRationale =
            `None of the four Annex 2 questions is answered yes on the reported information. ` +
            `This does not close the event; it records that the notification duty has not been triggered.`;
    }

    // ---- RRA legs. Hazard is the pathogen, exposure is who meets it, context
    // is everything around both. Splitting them this way is WHO's structure,
    // not a presentational choice.
    const hazard = sentences([
        `${disease} reported in ${place}; ${burden(input)}`,
        ...score.severity.reasons,
        ...score.unusualness.reasons,
    ]);

    const exposure = sentences([
        ...score.spread.reasons,
        ...(score.spread.reasons.length
            ? []
            : ['No transmission dynamics described in the source report; exposure pathway is unconfirmed']),
    ]);

    const context = sentences([
        ...score.ksaRelevance.reasons,
        ...score.tradeTravel.reasons,
        ...(score.ksaRelevance.reasons.length
            ? []
            : [`${place} is outside the Kingdom's immediate corridors on the geography held in the system`]),
    ]);

    // ---- Uncertainties. These are the things a reviewer would otherwise have
    // to notice were missing, which is exactly what gets missed under load.
    const uncertainties: string[] = [];
    if ((input.cases ?? 0) === 0 && (input.deaths ?? 0) === 0) {
        uncertainties.push(
            'No case or death counts in the source report, so severity rests on the characteristics of the disease rather than observed burden.'
        );
    }
    if (score.unusualness.reasons.some((r) => r.includes('no baseline on record'))) {
        uncertainties.push(
            'No baseline on record for this disease, so no expected level was available to compare against.'
        );
    }
    if (input.countBasis === 'historical_cumulative') {
        uncertainties.push(
            `The figures are a historical running total${input.countPeriod ? ` (${input.countPeriod})` : ''}, not current incidence. ` +
            `They are excluded from the magnitude rules, so this assessment says nothing about how active the situation is now — ` +
            `establishing the recent case count is the first thing to verify.`
        );
    } else if (!input.countBasis || input.countBasis === 'unknown') {
        if ((input.cases ?? 0) > 0 || (input.deaths ?? 0) > 0) {
            uncertainties.push(
                'The source does not state what period the counts cover, so they are treated as current. If they turn out to be a running total, severity is overstated.'
            );
        }
    }
    if (score.confidence !== 'high') {
        uncertainties.push(
            `Single ${score.confidence}-confidence source (${input.sourceName || 'unnamed'}); not yet corroborated independently.`
        );
    }
    if (!score.spread.reasons.length) {
        uncertainties.push('Transmission route and human-to-human potential are not addressed in the report.');
    }
    if (input.dateReported) {
        uncertainties.push(
            `Assessment reflects information as reported on ${input.dateReported}; the situation may have moved since.`
        );
    }

    // ---- Recommendations. Each one is tied to the domain that raised it, so a
    // reviewer can drop the recommendation by disputing the domain.
    const recommendations: string[] = [];
    if (score.mandatoryIhr || yesCount >= 2) {
        recommendations.push('Notify the WHO IHR National Focal Point within 24 hours of this assessment (IHR Article 6).');
    }
    recommendations.push(
        'Verify against a second independent source before escalation — WHO event-based surveillance places verification before risk assessment.'
    );
    if (score.severity.score >= 2) {
        recommendations.push(`Request the line list and case definition in use from the reporting authority in ${place}.`);
    }
    if (score.spread.score >= 2) {
        recommendations.push(`Review points-of-entry screening and traveller advice for arrivals from ${place}.`);
    }
    if (score.ksaRelevance.score >= 2) {
        recommendations.push(`Confirm Kingdom laboratory capacity to confirm ${disease} and brief the PHA duty officer.`);
    }
    if (score.tradeTravel.score >= 2) {
        recommendations.push('Alert the trade and travel focal point that restriction measures may follow.');
    }
    if (score.confidence === 'low') {
        recommendations.push('Hold at verification: low-confidence stream, not eligible for escalation on this evidence alone.');
    }

    return {
        drafterVersion: DRAFTER_VERSION,
        scorerVersion: input.scorerVersion || SCORER_VERSION,
        generatedAt: now.toISOString(),
        tier: score.tier,
        ihr: {
            q1,
            q1Notes: note(score.severity, q1, 'No evidence in the reported information that the public health impact is serious.'),
            q2,
            q2Notes: note(score.unusualness, q2, 'Nothing in the reported information marks this event as unusual or unexpected.'),
            q3,
            q3Notes: note(score.spread, q3, 'No indication of international spread risk in the reported information.'),
            q4,
            q4Notes: note(score.tradeTravel, q4, 'No indication of travel or trade restriction risk in the reported information.'),
            yesCount,
            mandatoryIhr: score.mandatoryIhr,
            decision,
            decisionRationale,
        },
        rra: {
            hazard,
            exposure,
            context,
            overallRisk: RISK_BY_TIER[score.tier],
            confidenceLevel: CONFIDENCE_LABEL[score.confidence],
            keyUncertainties: uncertainties,
            recommendations,
        },
    };
}

/**
 * Reconstructs a `ScoreResult` from a stored `event_scores` row, whose evidence
 * is held as `{domain: string[]}`. Kept here rather than in the collector so the
 * accept path does not have to import the collector's scan machinery.
 */
export function scoreFromRow(row: {
    severity: number; unusualness: number; spread: number; tradeTravel: number; ksaRelevance: number;
    domainsAtTwo: number; tier: string; mandatoryIhr: boolean; confidence: string;
    evidence: unknown; reportsOccurrence?: boolean;
}): ScoreResult {
    const evidence = (row.evidence ?? {}) as Record<string, string[]>;
    const domain = (n: number, reasons: string[] | undefined): DomainScore => ({
        score: Math.max(0, Math.min(3, n)) as 0 | 1 | 2 | 3,
        reasons: reasons ?? [],
    });
    return {
        severity: domain(row.severity, evidence.severity),
        unusualness: domain(row.unusualness, evidence.unusualness),
        spread: domain(row.spread, evidence.spread),
        tradeTravel: domain(row.tradeTravel, evidence.tradeTravel),
        ksaRelevance: domain(row.ksaRelevance, evidence.ksaRelevance),
        domainsAtTwo: row.domainsAtTwo,
        tier: row.tier as ScoreResult['tier'],
        mandatoryIhr: row.mandatoryIhr,
        confidence: row.confidence as ScoreResult['confidence'],
        reportsOccurrence: row.reportsOccurrence ?? true,
    };
}
