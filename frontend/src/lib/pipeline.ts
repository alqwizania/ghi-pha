/**
 * The pipeline, in one place.
 *
 * Every view renders a slice of the same workflow, and until this file existed
 * each one invented its own vocabulary for it: the Dashboard counted active
 * assessments as `Draft | Under Review` while the Assessment view listed
 * `Draft | Under Assessment`, so a status the backend never wrote was being
 * matched in one place and a real one missed in the other. The screens
 * disagreed about the same rows.
 *
 * The flow the system implements:
 *
 *   Global Radar   — every collected event, scored
 *   Listener       — social stream (not yet ingesting)
 *        ↓  scorer promotes, or an analyst promotes by hand
 *   Triage         — accept or reject
 *        ↓  accept opens an assessment, machine-drafted
 *   Assessment     — IHR Annex 2 + RRA, analyst edits the draft
 *        ↓  escalate
 *   Escalation     — director review (surfaced on the Dashboard, not a tab)
 *
 * Archived is orthogonal to all of it: a record kept for audit and excluded
 * from every working queue.
 */

export const TRIAGE_STATUS = {
    pending: 'Pending Triage',
    accepted: 'Accepted',
    rejected: 'Rejected',
} as const;

export const ASSESSMENT_STATUS = {
    draft: 'Draft',
    inProgress: 'Under Assessment',
    escalated: 'Escalated',
    completed: 'Completed',
    archived: 'Archived',
} as const;

export const SIGNAL_STATUS = {
    new: 'New',
    awaitingTriage: 'Awaiting Triage',
    underAssessment: 'Under Assessment',
    archived: 'Archived',
} as const;

/** Assessments sitting in someone's queue — not escalated, not archived. */
export const OPEN_ASSESSMENT_STATUSES: string[] = [
    ASSESSMENT_STATUS.draft,
    ASSESSMENT_STATUS.inProgress,
];

export const isOpenAssessment = (a: { status?: string | null }) =>
    OPEN_ASSESSMENT_STATUSES.includes(a?.status ?? '');

export const isArchived = (r: { status?: string | null; currentStatus?: string | null }) =>
    r?.status === ASSESSMENT_STATUS.archived || r?.currentStatus === SIGNAL_STATUS.archived;

/** Risk tiers, ordered. Shared so ordering and colour never drift between views. */
export const RISK_TIERS = ['Low', 'Moderate', 'High', 'Critical'] as const;
export type RiskTier = typeof RISK_TIERS[number];

export const TIER_TO_RISK: Record<string, RiskTier> = {
    routine: 'Low',
    moderate: 'Moderate',
    high: 'High',
    critical: 'Critical',
};
