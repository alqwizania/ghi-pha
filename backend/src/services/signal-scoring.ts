/**
 * Priority scoring, grounded in IHR (2005) Annex 2.
 *
 * Signals are scored on the same axes analysts apply downstream in the
 * assessment view, so a high triage score is a *prediction of the IHR outcome*
 * rather than a separate opinion about it. Every weight below traces to the
 * decision instrument; none of it is tuned by feel.
 *
 * Founding principle: anomaly is deviation from expectation, not magnitude.
 * Forty cholera cases in Yemen during an ongoing epidemic is background; four
 * in Riyadh is an emergency. Severity is therefore judged against the
 * disease-and-place baseline in `disease_baselines`, never against raw counts.
 *
 * Auditability is the other constraint. The arithmetic here is deterministic
 * and the evidence behind every domain is stored with the score, so an analyst
 * can see *why* something scored high and challenge it. Where reading the text
 * is unavoidable, the model supplies structured boolean indicators and the
 * scoring still happens here — "the model decided" is not an explanation a
 * health authority can defend.
 */

/**
 * v2 (3 Aug 2026) — indicators now actually reach the scorer, and historical
 * cumulative counts are excluded from the magnitude rules. Both change what a
 * given event scores, so stored scores carry the version that produced them.
 */
export const SCORER_VERSION = 'ihr-annex2-v2';

/** GCC members plus the neighbours sharing borders, corridors or pilgrim flows. */
const GCC = new Set(['Saudi Arabia', 'United Arab Emirates', 'UAE', 'Qatar', 'Bahrain', 'Kuwait', 'Oman']);
const NEIGHBOURING = new Set([
  'Yemen', 'Iraq', 'Jordan', 'Egypt', 'Sudan', 'Syria', 'Iran', 'Eritrea', 'Djibouti', 'Somalia',
]);
/** Major pilgrim-origin and migrant-worker corridors into the Kingdom. */
const HIGH_CONNECTIVITY = new Set([
  'Pakistan', 'India', 'Indonesia', 'Bangladesh', 'Nigeria', 'Turkey', 'Türkiye',
  'Malaysia', 'Philippines', 'Ethiopia', 'Morocco', 'Algeria', 'Tunisia', 'Afghanistan',
]);

/**
 * Mass-gathering windows raise KSA relevance for respiratory and faecal-oral
 * hazards. Deliberately empty: Hajj moves ~11 days earlier each Gregorian year
 * and encoding a guessed date would be worse than encoding none. PHA should
 * set these annually as {start: 'YYYY-MM-DD', end: 'YYYY-MM-DD'}.
 */
export const MASS_GATHERING_WINDOWS: Array<{ name: string; start: string; end: string }> = [];

/**
 * What span a case or death count covers.
 *
 * Counts are uninterpretable without this. WHO's MERS page reports 2,226 cases
 * in Saudi Arabia "since 2012"; compared against an expected annual total it
 * reads as eleven times the yearly burden, which scored the Kingdom's routine
 * surveillance page as a critical event. Fourteen years of cases is not an
 * anomaly, so `historical_cumulative` counts are excluded from the magnitude
 * rules entirely rather than discounted by some invented factor.
 */
export type CountBasis = 'outbreak_to_date' | 'period' | 'historical_cumulative' | 'unknown';

export interface ScoringInput {
    disease: string;
    country: string;
    cases: number | null;
    deaths: number | null;
    title: string;
    summary: string;
    dateReported: string | null;
    sourceId: string;
    /** Structured indicators read off the source text by the extractor. */
    indicators?: EpiIndicators;
    /** What span the counts cover. Absent is treated as 'unknown'. */
    countBasis?: CountBasis;
    /** The reporting window as the source worded it, for the evidence trail. */
    countPeriod?: string | null;
}

/**
 * Whether a count can carry a magnitude judgement.
 *
 * `unknown` is allowed through deliberately. Most sources never state a window,
 * and excluding them would silence the majority of real signals to avoid a
 * minority of inflated ones. The uncertainty is recorded on the assessment
 * draft instead, where an analyst sees it.
 */
function countsAreCurrent(input: ScoringInput): boolean {
    return input.countBasis !== 'historical_cumulative';
}

export interface EpiIndicators {
    novelPathogen?: boolean;
    outsideKnownRange?: boolean;
    unusualPresentation?: boolean;
    humanToHuman?: boolean;
    healthcareWorkerInfections?: boolean;
    multiCountry?: boolean;
    travelRestrictions?: boolean;
    healthSystemStrain?: boolean;
    vulnerableGroups?: boolean;
    antimicrobialResistance?: boolean;
}

export interface DiseaseBaseline {
    disease: string;
    country: string | null;
    endemicStatus: 'endemic' | 'sporadic' | 'absent' | 'eliminated';
    expectedAnnualCases: number | null;
    baselineCfr: number | null;
    transmissionRoute: string | null;
    ihrNotifiable: boolean;
    ihrAssessAlways: boolean;
}

export interface DomainScore {
    score: 0 | 1 | 2 | 3;
    reasons: string[];
}

export interface ScoreResult {
    severity: DomainScore;
    unusualness: DomainScore;
    spread: DomainScore;
    tradeTravel: DomainScore;
    ksaRelevance: DomainScore;
    /** How many IHR domains reached 2 — the escalation rule operates on this. */
    domainsAtTwo: number;
    tier: 'critical' | 'high' | 'moderate' | 'routine';
    mandatoryIhr: boolean;
    confidence: 'high' | 'medium' | 'low';
    /**
     * Whether the item describes a disease actually occurring, as opposed to a
     * vaccination campaign, preparedness exercise or funding announcement.
     * Drives the radar's default filter — informational items are recorded but
     * not surfaced as things to act on.
     */
    reportsOccurrence: boolean;
}

/** Source credibility. Separate from severity: a credible source does not make an outbreak worse. */
const HIGH_CONFIDENCE_SOURCES = new Set([
    'WHO_DONS', 'WHO_MPX_API', 'WHO', 'WHO_AFRO', 'WHO_EURO', 'WHO_EMRO_MERS', 'WHO_SEARO',
    'WHO_WPRO', 'WHO_SITREP', 'WHO_COVID_SITREP', 'ECDC', 'ECDC_CDTR', 'ECDC_OUTBREAKS',
    'PAHO', 'UK_UKHSA', 'UK_HPR', 'CDC', 'CDC_TRAVEL', 'GPEI_POLIO', 'GTFCC_CHOLERA',
]);

export function sourceConfidence(sourceId: string, stream: 'radar' | 'listener' = 'radar'): 'high' | 'medium' | 'low' {
    if (stream === 'listener') return 'low';
    if (HIGH_CONFIDENCE_SOURCES.has(sourceId)) return 'high';
    return 'medium';
}

/**
 * Picks the country-specific baseline where one exists, else the global default.
 *
 * Matching is deliberately one-directional: the *event's* disease name may
 * contain the baseline name, never the reverse. Allowing both let a generic
 * "Influenza" event match the "Influenza A(H5N1)" baseline and inherit its 50%
 * CFR, scoring seasonal flu as though it were avian influenza. Longer baseline
 * names win, so "Influenza A(H5N1)" beats "Influenza" on a specific event.
 */
export function resolveBaseline(
    baselines: DiseaseBaseline[],
    disease: string,
    country: string
): DiseaseBaseline | null {
    const d = (disease || '').toLowerCase().trim();
    const c = (country || '').toLowerCase();
    if (!d) return null;

    const matches = baselines
        .filter((b) => {
            const bd = b.disease.toLowerCase();
            return d === bd || d.includes(bd);
        })
        .sort((a, b) => b.disease.length - a.disease.length);

    if (matches.length === 0) return null;

    const best = matches[0].disease.toLowerCase();
    const equallySpecific = matches.filter((m) => m.disease.toLowerCase() === best);
    return (
        equallySpecific.find((b) => b.country && b.country.toLowerCase() === c) ??
        equallySpecific.find((b) => !b.country) ??
        equallySpecific[0]
    );
}

/**
 * Whether the item describes an actual occurrence rather than preparedness,
 * vaccination, guidance or funding news. IHR Annex 2's notification duty
 * attaches to *detecting* a case, so a polio vaccination campaign must not
 * escalate merely because polio is on the always-notifiable list.
 */
export function reportsOccurrence(input: ScoringInput): boolean {
    if ((input.cases ?? 0) > 0 || (input.deaths ?? 0) > 0) return true;
    const text = `${input.title} ${input.summary}`.toLowerCase();
    if (/\b(campaign|vaccination drive|immunisation drive|immunization drive|preparedness|training|workshop|funding|guidance|toolkit|commemorat|anniversar|appoint)\b/.test(text)) {
        return false;
    }
    return /\b(case|cases|outbreak|death|deaths|infected|confirmed|detected|reported in|cluster|epidemic|positive sample)\b/.test(text);
}

/** IHR Q1 — is the public health impact serious? */
function scoreSeverity(input: ScoringInput, baseline: DiseaseBaseline | null): DomainScore {
    const reasons: string[] = [];
    let score = 0;

    const cases = input.cases ?? 0;
    const deaths = input.deaths ?? 0;
    const current = countsAreCurrent(input);
    const observedCfr = cases > 0 ? (deaths / cases) * 100 : null;

    // A multi-year running total says nothing about how bad things are now, and
    // its CFR is drawn from the same history the baseline came from, so
    // comparing the two is circular. Severity for these rests on what the
    // pathogen is, not on how many cases it has caused since 2012.
    if (!current) {
        reasons.push(
            input.countPeriod
                ? `counts cover ${input.countPeriod} and are excluded from the magnitude rules as a historical total`
                : 'counts are a historical cumulative total and are excluded from the magnitude rules'
        );
    }

    if (current && observedCfr !== null && baseline?.baselineCfr != null) {
        if (observedCfr > baseline.baselineCfr * 1.5 && deaths >= 3) {
            score = Math.max(score, 3);
            reasons.push(`observed CFR ${observedCfr.toFixed(1)}% exceeds the ${baseline.baselineCfr}% baseline for ${baseline.disease}`);
        } else if (observedCfr >= baseline.baselineCfr && deaths >= 1) {
            score = Math.max(score, 2);
            reasons.push(`observed CFR ${observedCfr.toFixed(1)}% is at or above the ${baseline.baselineCfr}% baseline`);
        }
    }

    // A high-lethality pathogen is serious on its own terms, even at low counts.
    if (baseline?.baselineCfr != null && baseline.baselineCfr >= 30) {
        score = Math.max(score, 2);
        reasons.push(`${baseline.disease} carries a baseline CFR of ${baseline.baselineCfr}%`);
    }

    if (current && deaths >= 100) {
        score = Math.max(score, 3);
        reasons.push(`${deaths} deaths reported`);
    } else if (current && deaths >= 10) {
        score = Math.max(score, 2);
        reasons.push(`${deaths} deaths reported`);
    } else if (current && deaths >= 1) {
        score = Math.max(score, 1);
        reasons.push(`${deaths} death${deaths === 1 ? '' : 's'} reported`);
    }

    // Deviation from expectation, not magnitude.
    if (!current) {
        // Nothing count-derived applies; severity is carried by the pathogen
        // characteristics and indicators handled below.
    } else if (baseline?.expectedAnnualCases && cases > 0) {
        const ratio = cases / baseline.expectedAnnualCases;
        if (ratio >= 1) {
            score = Math.max(score, 3);
            reasons.push(`${cases} cases is ${ratio.toFixed(1)}x the expected annual total for ${input.country}`);
        } else if (ratio >= 0.25) {
            score = Math.max(score, 2);
            reasons.push(`${cases} cases is ${(ratio * 100).toFixed(0)}% of the expected annual total`);
        }
    } else if (baseline?.endemicStatus === 'absent' && cases > 0) {
        score = Math.max(score, 2);
        reasons.push(`${cases} case${cases === 1 ? '' : 's'} of a disease not normally present in ${input.country}`);
    }

    if (input.indicators?.healthSystemStrain) {
        score = Math.max(score, 2);
        reasons.push('health system strain reported');
    }
    if (input.indicators?.vulnerableGroups) {
        score = Math.min(3, score + 1);
        reasons.push('vulnerable populations affected');
    }

    return { score: Math.min(3, score) as 0 | 1 | 2 | 3, reasons };
}

/** IHR Q2 — is the event unusual or unexpected? Novelty is the strongest PHEIC predictor. */
function scoreUnusualness(input: ScoringInput, baseline: DiseaseBaseline | null): DomainScore {
    const reasons: string[] = [];
    let score = 0;

    if (input.indicators?.novelPathogen) {
        score = 3;
        reasons.push('novel pathogen or new subtype reported');
    }
    if (input.indicators?.outsideKnownRange) {
        score = Math.max(score, 3);
        reasons.push('disease reported outside its known geographic range');
    }
    if (input.indicators?.unusualPresentation) {
        score = Math.max(score, 2);
        reasons.push('unusual clinical presentation or severity');
    }
    if (input.indicators?.antimicrobialResistance) {
        score = Math.max(score, 2);
        reasons.push('new antimicrobial resistance profile');
    }

    if (baseline) {
        if (baseline.endemicStatus === 'absent' || baseline.endemicStatus === 'eliminated') {
            score = Math.max(score, 3);
            reasons.push(`${baseline.disease} is not established in ${input.country}`);
        } else if (baseline.endemicStatus === 'sporadic') {
            score = Math.max(score, 1);
            reasons.push(`${baseline.disease} occurs only sporadically in ${input.country}`);
        } else {
            reasons.push(`${baseline.disease} is endemic in ${input.country}; occurrence is expected`);
        }
    } else {
        // No baseline means the disease is not in the reference table at all,
        // which is itself weak evidence of something out of the ordinary.
        score = Math.max(score, 1);
        reasons.push('no baseline on record for this disease');
    }

    return { score: Math.min(3, score) as 0 | 1 | 2 | 3, reasons };
}

/** IHR Q3 — significant risk of international spread? */
function scoreSpread(input: ScoringInput, baseline: DiseaseBaseline | null): DomainScore {
    const reasons: string[] = [];
    let score = 0;

    // Healthcare-worker infection is a classic sentinel for sustained
    // human-to-human transmission and is weighted accordingly.
    if (input.indicators?.healthcareWorkerInfections) {
        score = 3;
        reasons.push('healthcare worker infections reported — sentinel for human-to-human transmission');
    }
    if (input.indicators?.humanToHuman) {
        score = Math.max(score, 3);
        reasons.push('human-to-human transmission reported');
    }
    if (input.indicators?.multiCountry) {
        score = Math.max(score, 2);
        reasons.push('cases reported in more than one country');
    }

    const route = baseline?.transmissionRoute;
    if (route === 'respiratory') {
        score = Math.max(score, 2);
        reasons.push('respiratory transmission route');
    } else if (route === 'faecal-oral' || route === 'contact') {
        score = Math.max(score, 1);
        reasons.push(`${route} transmission route`);
    }

    return { score: Math.min(3, score) as 0 | 1 | 2 | 3, reasons };
}

/** IHR Q4 — significant risk of travel or trade restrictions? */
function scoreTradeTravel(input: ScoringInput, baseline: DiseaseBaseline | null): DomainScore {
    const reasons: string[] = [];
    let score = 0;

    if (input.indicators?.travelRestrictions) {
        score = 3;
        reasons.push('travel advisories or border measures reported');
    }
    if (input.sourceId === 'CDC_TRAVEL') {
        score = Math.max(score, 2);
        reasons.push('published as a travel health notice');
    }
    if (baseline?.ihrNotifiable) {
        score = Math.max(score, 2);
        reasons.push(`${baseline.disease} has precedent for international restrictions`);
    }
    const text = `${input.title} ${input.summary}`.toLowerCase();
    if (/\b(travel (advisory|ban|restriction)|border clos|export ban|livestock (ban|restriction)|quarantine)\b/.test(text)) {
        score = Math.max(score, 2);
        reasons.push('restriction language present in the report');
    }

    return { score: Math.min(3, score) as 0 | 1 | 2 | 3, reasons };
}

/** RRA context leg, specialised for the Kingdom. A modifier, never a fifth vote. */
function scoreKsaRelevance(input: ScoringInput, baseline: DiseaseBaseline | null, today: Date): DomainScore {
    const reasons: string[] = [];
    let score = 0;
    const country = input.country || '';

    if (country === 'Saudi Arabia') {
        score = 3;
        reasons.push('event is inside the Kingdom');
    } else if (GCC.has(country)) {
        score = 2;
        reasons.push('GCC member state');
    } else if (NEIGHBOURING.has(country)) {
        score = 2;
        reasons.push('shares a border or corridor with the Kingdom');
    } else if (HIGH_CONNECTIVITY.has(country)) {
        score = 1;
        reasons.push('major pilgrim or migrant-worker corridor');
    }

    const route = baseline?.transmissionRoute;
    const gatheringSensitive = route === 'respiratory' || route === 'faecal-oral';
    if (gatheringSensitive && score > 0) {
        const iso = today.toISOString().substring(0, 10);
        const window = MASS_GATHERING_WINDOWS.find((w) => iso >= w.start && iso <= w.end);
        if (window) {
            score = Math.min(3, score + 1);
            reasons.push(`${window.name} is in progress and this hazard is gathering-sensitive`);
        }
    }

    if (baseline?.country === 'Saudi Arabia' && baseline.endemicStatus === 'endemic') {
        reasons.push(`${baseline.disease} is endemic in the Kingdom; occurrence is expected rather than novel`);
    }

    return { score: Math.min(3, score) as 0 | 1 | 2 | 3, reasons };
}

/**
 * Scores one event.
 *
 * The escalation rule is IHR Annex 2's own: a State Party must notify WHO when
 * *any two of the four* questions are answered yes, so a signal is high
 * priority when at least two domains reach 2. KSA relevance is a one-tier
 * modifier rather than a fifth vote — an event that is moderate globally can
 * be urgent regionally, but relevance alone never escalates.
 */
export function scoreEvent(
    input: ScoringInput,
    baselines: DiseaseBaseline[],
    stream: 'radar' | 'listener' = 'radar',
    now: Date = new Date()
): ScoreResult {
    const baseline = resolveBaseline(baselines, input.disease, input.country);

    const severity = scoreSeverity(input, baseline);
    const unusualness = scoreUnusualness(input, baseline);
    const spread = scoreSpread(input, baseline);
    const tradeTravel = scoreTradeTravel(input, baseline);
    const ksaRelevance = scoreKsaRelevance(input, baseline, now);

    const ihrDomains = [severity, unusualness, spread, tradeTravel];
    const domainsAtTwo = ihrDomains.filter((d) => d.score >= 2).length;

    let tier: ScoreResult['tier'];
    if (domainsAtTwo >= 3) tier = 'critical';
    else if (domainsAtTwo >= 2) tier = 'high';
    else if (domainsAtTwo === 1) tier = 'moderate';
    else tier = 'routine';

    // Relevance lifts one tier but cannot create an escalation on its own.
    if (ksaRelevance.score >= 2 && tier !== 'critical' && domainsAtTwo >= 1) {
        tier = tier === 'high' ? 'critical' : 'high';
        ksaRelevance.reasons.push('regional relevance raised this one tier');
    }

    // IHR Annex 2 always-notifiable diseases bypass scoring entirely — but the
    // duty attaches to detecting a case, not to the disease being mentioned.
    // Without this guard a polio vaccination campaign escalates as critical.
    const occurrence = reportsOccurrence(input);
    const mandatoryIhr = baseline?.ihrNotifiable === true && occurrence;
    if (mandatoryIhr) {
        tier = 'critical';
    }

    // Nothing that merely discusses a disease should reach triage on its own.
    if (!occurrence && tier !== 'routine') {
        tier = 'moderate';
        ksaRelevance.reasons.push('item describes activity around the disease rather than a reported occurrence');
    }

    return {
        severity,
        unusualness,
        spread,
        tradeTravel,
        ksaRelevance,
        domainsAtTwo,
        tier,
        mandatoryIhr,
        confidence: sourceConfidence(input.sourceId, stream),
        reportsOccurrence: occurrence,
    };
}

/**
 * Whether a scored event should be promoted into triage automatically.
 * Low-confidence sources are never auto-promoted — WHO's event-based
 * surveillance process puts verification before risk assessment, and
 * collapsing the two is how a surveillance system escalates a rumour.
 */
export function shouldAutoPromote(score: ScoreResult): boolean {
    if (score.confidence === 'low') return false;
    return score.mandatoryIhr || score.tier === 'critical' || score.tier === 'high';
}
