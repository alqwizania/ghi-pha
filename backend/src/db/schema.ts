import { pgTable, uuid, text, varchar, timestamp, date, integer, numeric, smallint, boolean, jsonb } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const signals = pgTable("signals", {
    id: uuid("id").primaryKey().defaultRandom(),
    beaconEventId: varchar("beacon_event_id", { length: 255 }).unique(),
    sourceUrl: text("source_url").notNull(),
    sourceOrigin: varchar("source_origin", { length: 50 }).default("listener"), // listener vs radar
    sourceName: varchar("source_name", { length: 255 }),
    boardType: varchar("board_type", { length: 50 }).default("biological"), // biological vs environmental_cbrn
    rawData: jsonb("raw_data").notNull(),
    disease: varchar("disease", { length: 255 }).notNull(),
    country: varchar("country", { length: 100 }).notNull(),
    location: varchar("location", { length: 255 }),
    dateReported: date("date_reported").notNull(),
    dateOnset: date("date_onset"),
    cases: integer("cases").default(0),
    deaths: integer("deaths").default(0),
    caseFatalityRate: numeric("case_fatality_rate", { precision: 5, scale: 2 }),
    description: text("description"),
    outbreakStatus: varchar("outbreak_status", { length: 50 }),
    triageStatus: varchar("triage_status", { length: 50 }).default("Pending Triage"),
    triagedBy: uuid("triaged_by"),
    triagedAt: timestamp("triaged_at", { withTimezone: true }),
    triageNotes: text("triage_notes"),
    rejectionReason: text("rejection_reason"),
    priorityScore: numeric("priority_score", { precision: 5, scale: 2 }),
    gccRelevant: boolean("gcc_relevant").default(false),
    saudiRiskLevel: varchar("saudi_risk_level", { length: 20 }),
    currentStatus: varchar("current_status", { length: 50 }).default("New"),
    verificationStatus: varchar("verification_status", { length: 50 }).default("Unverified"), // Unverified, Pending Verification, Verified
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verificationDeadline: timestamp("verification_deadline", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    lastBeaconSync: timestamp("last_beacon_sync", { withTimezone: true }),
    // Which stream produced this signal, and — for radar signals — the event
    // and whether scoring promoted it automatically. Added by migration 011.
    sourceStream: varchar("source_stream", { length: 20 }).default("radar").notNull(),
    radarEventId: uuid("radar_event_id"),
    autoPromoted: boolean("auto_promoted").default(false).notNull(),
});

export const assessments = pgTable("assessments", {
    id: uuid("id").primaryKey().defaultRandom(),
    signalId: uuid("signal_id").references(() => signals.id, { onDelete: "cascade" }).notNull(),
    assessmentType: varchar("assessment_type", { length: 50 }).notNull(),
    ihrQuestion1: boolean("ihr_question_1"),
    ihrQuestion1Notes: text("ihr_question_1_notes"),
    ihrQuestion2: boolean("ihr_question_2"),
    ihrQuestion2Notes: text("ihr_question_2_notes"),
    ihrQuestion3: boolean("ihr_question_3"),
    ihrQuestion3Notes: text("ihr_question_3_notes"),
    ihrQuestion4: boolean("ihr_question_4"),
    ihrQuestion4Notes: text("ihr_question_4_notes"),
    ihrDecision: varchar("ihr_decision", { length: 50 }),
    rraHazardAssessment: jsonb("rra_hazard_assessment"),
    rraExposureAssessment: jsonb("rra_exposure_assessment"),
    rraContext_assessment: jsonb("rra_context_assessment"),
    rraOverallRisk: varchar("rra_overall_risk", { length: 20 }),
    rraConfidenceLevel: varchar("rra_confidence_level", { length: 20 }),
    rraKeyUncertainties: jsonb("rra_key_uncertainties"),
    rraRecommendations: jsonb("rra_recommendations"),
    status: varchar("status", { length: 50 }).default("Draft"),
    assignedTo: uuid("assigned_to").notNull(),
    reviewedBy: uuid("reviewed_by"),
    // The frozen machine first pass, written once on accept. The live columns
    // above start as a copy of it and are the analyst's from then on, so the
    // difference between the two *is* the human override. Added by migration 014.
    machineDraft: jsonb("machine_draft"),
    machineDrafterVersion: varchar("machine_drafter_version", { length: 40 }),
    machineScorerVersion: varchar("machine_scorer_version", { length: 20 }),
    machineGeneratedAt: timestamp("machine_generated_at", { withTimezone: true }),
    machineConfidence: varchar("machine_confidence", { length: 10 }),
    // That a person opened and saved the assessment — a different fact from
    // having changed anything. Agreeing with the draft is still a review.
    humanReviewedAt: timestamp("human_reviewed_at", { withTimezone: true }),
    outcomeDecision: varchar("outcome_decision", { length: 50 }),
    outcomeJustification: text("outcome_justification"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const escalations = pgTable("escalations", {
    id: uuid("id").primaryKey().defaultRandom(),
    signalId: uuid("signal_id").references(() => signals.id).notNull(),
    assessmentId: uuid("assessment_id").references(() => assessments.id).notNull(),
    escalationLevel: varchar("escalation_level", { length: 50 }).default("Director"),
    priority: varchar("priority", { length: 20 }).notNull(),
    escalationReason: text("escalation_reason").notNull(),
    recommendedActions: jsonb("recommended_actions"),
    directorStatus: varchar("director_status", { length: 50 }).default("Pending Review"),
    directorDecision: text("director_decision"),
    directorNotes: text("director_notes"),
    actionsTaken: jsonb("actions_taken"),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }).defaultNow(),
    escalatedBy: uuid("escalated_by").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const surveillanceSources = pgTable("surveillance_sources", {
    id: varchar("id", { length: 100 }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    type: varchar("type", { length: 50 }).notNull(), // beacon, who, cdc, promed, ecdc, rss, api
    url: text("url").notNull(),
    category: varchar("category", { length: 50 }).default("biological"), // biological vs environmental_cbrn
    enabled: boolean("enabled").default(true),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    status: varchar("status", { length: 50 }).default("active"),
    fetchIntervalHours: integer("fetch_interval_hours").default(2),
    // How the collector retrieves this source, and which extractor parses it.
    // Added by migrations/002_source_registry.mjs.
    fetchStrategy: varchar("fetch_strategy", { length: 20 }).default("html").notNull(),
    parserHint: varchar("parser_hint", { length: 60 }),
    priorityBoost: integer("priority_boost").default(0).notNull(),
    tags: jsonb("tags").default([]).notNull(),
    config: jsonb("config").default({}).notNull(),
    disabledReason: text("disabled_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Last-seen content hash per source. This is the change detection: a scan
// fetches, normalizes, hashes, and only extracts when the hash moved.
// See migrations/002_source_registry.mjs.
export const sourceSnapshots = pgTable("source_snapshots", {
    sourceId: varchar("source_id", { length: 100 }).primaryKey()
        .references(() => surveillanceSources.id, { onDelete: "cascade" }),
    contentHash: text("content_hash"),
    contentBytes: integer("content_bytes"),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true }),
    lastStatus: varchar("last_status", { length: 20 }).default("unknown").notNull(),
    lastError: text("last_error"),
    consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
    eventsLastExtracted: integer("events_last_extracted").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const radarEvents = pgTable("radar_events", {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: varchar("source_id", { length: 100 }).references(() => surveillanceSources.id),
    sourceName: varchar("source_name", { length: 255 }).notNull(),
    title: text("title").notNull(),
    disease: varchar("disease", { length: 255 }).notNull(),
    country: varchar("country", { length: 100 }).notNull(),
    lat: numeric("lat", { precision: 9, scale: 6 }),
    lng: numeric("lng", { precision: 9, scale: 6 }),
    dateReported: date("date_reported").notNull(),
    cases: integer("cases").default(0),
    deaths: integer("deaths").default(0),
    cfr: numeric("cfr", { precision: 5, scale: 2 }),
    // What span `cases` and `deaths` cover. A multi-year running total is not an
    // anomaly, so scoring excludes historical_cumulative counts from the
    // magnitude rules. Added by migration 015.
    countBasis: varchar("count_basis", { length: 24 }).default("unknown"),
    countPeriod: varchar("count_period", { length: 80 }),
    // The ten epidemiological booleans the extractor reads off the source. These
    // were collected and then dropped for want of a column, which made every
    // indicator-driven scoring rule dead code. See migration 015.
    indicators: jsonb("indicators"),
    // Bumped whenever a re-report revises this event's facts. Scoring compares
    // it against event_scores.scored_at to find events whose score went stale.
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    summary: text("summary"),
    sourceUrl: text("source_url").notNull(),
    boardType: varchar("board_type", { length: 50 }).default("biological"),
    riskLevel: varchar("risk_level", { length: 20 }).default("Moderate"),
    isPromoted: boolean("is_promoted").default(false),
    promotedSignalId: uuid("promoted_signal_id").references(() => signals.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    // Generated in Postgres as md5(source_id || '::' || lower(btrim(title))) and
    // backed by a unique index — see migrations/001_radar_events_unique.mjs.
    // Never written by the application; declared here so drizzle-kit does not
    // treat the column as drift.
    contentHash: text("content_hash"),
});

// What "expected" looks like per disease per country. A NULL country is the
// global default; a country row overrides it. See migration 012.
export const diseaseBaselines = pgTable("disease_baselines", {
    id: uuid("id").primaryKey().defaultRandom(),
    disease: varchar("disease", { length: 120 }).notNull(),
    country: varchar("country", { length: 100 }),
    endemicStatus: varchar("endemic_status", { length: 20 }).default("absent").notNull(),
    expectedAnnualCases: integer("expected_annual_cases"),
    baselineCfr: numeric("baseline_cfr", { precision: 5, scale: 2 }),
    transmissionRoute: varchar("transmission_route", { length: 40 }),
    ihrNotifiable: boolean("ihr_notifiable").default(false).notNull(),
    ihrAssessAlways: boolean("ihr_assess_always").default(false).notNull(),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Five IHR-derived domain scores per event, with the evidence behind each.
// Storing only a total would make escalations unauditable.
export const eventScores = pgTable("event_scores", {
    radarEventId: uuid("radar_event_id").primaryKey()
        .references(() => radarEvents.id, { onDelete: "cascade" }),
    severity: smallint("severity").default(0).notNull(),
    unusualness: smallint("unusualness").default(0).notNull(),
    spread: smallint("spread").default(0).notNull(),
    tradeTravel: smallint("trade_travel").default(0).notNull(),
    ksaRelevance: smallint("ksa_relevance").default(0).notNull(),
    domainsAtTwo: smallint("domains_at_two").default(0).notNull(),
    tier: varchar("tier", { length: 12 }).default("routine").notNull(),
    mandatoryIhr: boolean("mandatory_ihr").default(false).notNull(),
    confidence: varchar("confidence", { length: 10 }).default("medium").notNull(),
    evidence: jsonb("evidence").default({}).notNull(),
    reportsOccurrence: boolean("reports_occurrence").default(true).notNull(),
    scorerVersion: varchar("scorer_version", { length: 20 }).notNull(),
    scoredAt: timestamp("scored_at", { withTimezone: true }).defaultNow().notNull(),
});

// Corroboration between signals across streams. An official source confirming
// a social one raises confidence, not severity.
export const signalLinks = pgTable("signal_links", {
    id: uuid("id").primaryKey().defaultRandom(),
    fromType: varchar("from_type", { length: 20 }).notNull(),
    fromId: uuid("from_id").notNull(),
    toType: varchar("to_type", { length: 20 }).notNull(),
    toId: uuid("to_id").notNull(),
    linkType: varchar("link_type", { length: 20 }).notNull(),
    confidence: numeric("confidence", { precision: 3, scale: 2 }),
    rationale: text("rationale"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable("users", {
    id: uuid("id").primaryKey().defaultRandom(),
    username: varchar("username", { length: 100 }).unique().notNull(),
    email: varchar("email", { length: 255 }).unique().notNull(),
    fullName: varchar("full_name", { length: 255 }).notNull(),
    role: varchar("role", { length: 50 }).notNull().default("Analyst"),
    passwordHash: text("password_hash").notNull(),
    permissions: jsonb("permissions").default({
        dashboard: 'view',
        radar: 'view',
        listener: 'view',
        triage: 'view',
        assessment: 'view',
    }),
    lastLogin: timestamp("last_login", { withTimezone: true }),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Social Listening Tables
export const socialSignals = pgTable("social_signals", {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: varchar("platform", { length: 50 }).default("twitter").notNull(),
    postId: varchar("post_id", { length: 255 }).unique().notNull(),
    author: varchar("author", { length: 255 }).notNull(),
    authorHandle: varchar("author_handle", { length: 255 }).notNull(),
    content: text("content").notNull(),
    language: varchar("language", { length: 10 }).default("en"),
    location: varchar("location", { length: 255 }),
    hashtags: jsonb("hashtags").default([]),
    mentions: jsonb("mentions").default([]),
    urls: jsonb("urls").default([]),
    engagement: jsonb("engagement").default({ likes: 0, retweets: 0, replies: 0 }),
    detectedKeywords: jsonb("detected_keywords").default([]),
    relevanceScore: numeric("relevance_score", { precision: 5, scale: 2 }).default("0"),
    sentimentScore: numeric("sentiment_score", { precision: 5, scale: 2 }),
    verificationStatus: varchar("verification_status", { length: 50 }).default("Pending"),
    relatedSignalId: uuid("related_signal_id").references(() => signals.id, { onDelete: "set null" }),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    promotedBy: uuid("promoted_by").references(() => users.id),
    isDismissed: boolean("is_dismissed").default(false),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const monitoredAccounts = pgTable("monitored_accounts", {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: varchar("platform", { length: 50 }).default("twitter").notNull(),
    accountHandle: varchar("account_handle", { length: 255 }).unique().notNull(),
    accountName: varchar("account_name", { length: 255 }).notNull(),
    accountType: varchar("account_type", { length: 50 }).notNull(), // official, media, expert, influencer
    region: varchar("region", { length: 100 }),
    priority: integer("priority").default(2), // 1=highest, 2=high, 3=medium
    isActive: boolean("is_active").default(true),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const listenerKeywords = pgTable("listener_keywords", {
    id: uuid("id").primaryKey().defaultRandom(),
    keyword: varchar("keyword", { length: 255 }).notNull(),
    category: varchar("category", { length: 50 }).notNull(), // disease, location, severity, organization
    language: varchar("language", { length: 10 }).default("en"),
    priority: integer("priority").default(2), // 1=critical, 2=high, 3=medium
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Relations
export const signalRelations = relations(signals, ({ many }) => ({
    assessments: many(assessments),
    escalations: many(escalations),
    socialSignals: many(socialSignals),
}));

export const userRelations = relations(users, ({ many }) => ({
    assessments: many(assessments),
    escalations: many(escalations),
    promotedSocialSignals: many(socialSignals),
}));

export const assessmentRelations = relations(assessments, ({ one, many }) => ({
    signal: one(signals, { fields: [assessments.signalId], references: [signals.id] }),
    assignedTo: one(users, { fields: [assessments.assignedTo], references: [users.id] }),
    escalations: many(escalations),
}));

export const escalationRelations = relations(escalations, ({ one }) => ({
    signal: one(signals, { fields: [escalations.signalId], references: [signals.id] }),
    assessment: one(assessments, { fields: [escalations.assessmentId], references: [assessments.id] }),
    escalatedBy: one(users, { fields: [escalations.escalatedBy], references: [users.id] }),
}));

export const socialSignalRelations = relations(socialSignals, ({ one }) => ({
    relatedSignal: one(signals, { fields: [socialSignals.relatedSignalId], references: [signals.id] }),
    promotedBy: one(users, { fields: [socialSignals.promotedBy], references: [users.id] }),
}));

