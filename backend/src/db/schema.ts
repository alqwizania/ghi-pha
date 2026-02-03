import { pgTable, uuid, text, varchar, timestamp, date, integer, numeric, boolean, jsonb } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const signals = pgTable("signals", {
    id: uuid("id").primaryKey().defaultRandom(),
    beaconEventId: varchar("beacon_event_id", { length: 255 }).unique(),
    sourceUrl: text("source_url").notNull(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    lastBeaconSync: timestamp("last_beacon_sync", { withTimezone: true }),
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

export const users = pgTable("users", {
    id: uuid("id").primaryKey().defaultRandom(),
    username: varchar("username", { length: 100 }).unique().notNull(),
    email: varchar("email", { length: 255 }).unique().notNull(),
    fullName: varchar("full_name", { length: 255 }).notNull(),
    role: varchar("role", { length: 50 }).notNull().default("Analyst"),
    passwordHash: text("password_hash").notNull(),
    permissions: jsonb("permissions").default({
        dashboard: 'view',
        triage: 'view',
        assessment: 'view',
        escalation: 'view'
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
