type D1Value = string | number | boolean | null;

export interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success: boolean;
  meta?: { changes?: number };
}

export interface D1Statement {
  bind(...values: D1Value[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1Statement;
}

export type FindingRecord = Record<string, unknown> & {
  id: number;
  disease: string;
  source: string;
  headline: string;
};

export type FindingInput = Record<string, unknown>;

export type QueryFindingsOptions = {
  disease?: string;
  source?: string;
  source_id?: string;
  risk?: string;
  publication_date?: string;
  publication_date_from?: string;
  notification_sent?: boolean;
  approved?: boolean;
  content_hash?: string;
  sort?: "publication_date" | "-publication_date" | "created_at" | "-created_at" | "id" | "-id";
  limit?: number;
  offset?: number;
};

type Statistics = {
  total_findings: number;
  total_critical: number;
  total_high: number;
  total_medium: number;
  total_low: number;
  unsent_count: number;
  today_count: number;
  generated_at: string;
  by_risk: Record<string, unknown>[];
  by_disease: Record<string, unknown>[];
  scan_runs: Record<string, unknown>[];
};

const FINDING_COLUMNS = [
  "disease",
  "source",
  "source_id",
  "source_type",
  "source_link",
  "publication_date",
  "headline",
  "short_description_en",
  "detailed_description_en",
  "short_description_ar",
  "detailed_description_ar",
  "content_hash",
  "risk",
  "risk_assessment",
  "countries_json",
  "regions_json",
  "notification_sent",
  "approved",
  "source_snapshot_id",
  "parser_payload_r2_key",
] as const;

const PATCHABLE_FINDING_COLUMNS = new Set<string>(FINDING_COLUMNS);

export class D1StorageAdapter {
  constructor(private readonly db: D1DatabaseLike) {}

  async create_finding_v3(finding: FindingInput): Promise<FindingRecord | null> {
    const now = new Date().toISOString();
    const data = this.mapFinding(finding, now);
    const columns = [...FINDING_COLUMNS, "created_at", "updated_at"];
    const values = [...FINDING_COLUMNS.map((column) => data[column]), now, now];
    const placeholders = columns.map(() => "?").join(", ");
    const result = await this.db.prepare(
      `insert or ignore into findings (${columns.join(", ")}) values (${placeholders})`,
    ).bind(...values).run();

    if ((result.meta?.changes ?? 0) === 0) return null;
    if (typeof data.content_hash === "string" && data.content_hash) {
      return this.getByColumn("content_hash", data.content_hash);
    }
    return this.db.prepare("select * from findings where rowid = last_insert_rowid()").first<FindingRecord>();
  }

  async write_finding_v3(finding: FindingInput): Promise<FindingRecord | null> {
    return this.create_finding_v3(finding);
  }

  async update_finding_v3(recordId: number | string, finding: FindingInput): Promise<boolean> {
    return this.patch_records([{ id: recordId, ...this.mapFinding(finding, new Date().toISOString()) }]);
  }

  async query_findings(options: QueryFindingsOptions = {}): Promise<FindingRecord[]> {
    const { where, params } = buildFindingWhere(options);
    const orderBy = sortSql(options.sort ?? "-publication_date");
    const limit = clampInt(options.limit, 100, 1, 1000);
    const offset = clampInt(options.offset, 0, 0, 100_000);
    const result = await this.db.prepare(
      `select * from findings where ${where.join(" and ")} ${orderBy} limit ? offset ?`,
    ).bind(...params, limit, offset).all<FindingRecord>();
    return result.results ?? [];
  }

  async query_findings_all(options: Omit<QueryFindingsOptions, "limit" | "offset"> & { page_size?: number; max_records?: number } = {}): Promise<{ list: FindingRecord[]; pages_fetched: number; truncated: boolean }> {
    const pageSize = clampInt(options.page_size, 1000, 1, 1000);
    const maxRecords = clampInt(options.max_records, 50_000, 1, 50_000);
    const list: FindingRecord[] = [];
    let pagesFetched = 0;

    while (list.length < maxRecords) {
      const batch = await this.query_findings({ ...options, limit: Math.min(pageSize, maxRecords - list.length), offset: list.length });
      pagesFetched += 1;
      if (batch.length === 0) break;
      list.push(...batch);
      if (batch.length < pageSize) break;
    }

    return { list, pages_fetched: pagesFetched, truncated: list.length >= maxRecords };
  }

  async patch_records(records: Array<Record<string, unknown> & { id: number | string }>): Promise<boolean> {
    for (const record of records) {
      const id = toSafeId(record.id);
      if (id === null) return false;

      const now = new Date().toISOString();
      const updates: string[] = [];
      const params: D1Value[] = [];
      for (const [key, value] of Object.entries(record)) {
        if (key === "id" || !PATCHABLE_FINDING_COLUMNS.has(key)) continue;
        updates.push(`${key} = ?`);
        params.push(toD1Value(normalizeField(key, value)));
      }
      if (updates.length === 0) continue;
      updates.push("updated_at = ?");
      params.push(now, id);
      await this.db.prepare(`update findings set ${updates.join(", ")} where id = ?`).bind(...params).run();
    }
    return true;
  }

  async query_unsent_findings(limit = 100): Promise<FindingRecord[]> {
    return this.query_findings({ notification_sent: false, approved: true, limit });
  }

  async mark_as_sent(recordIds: number[]): Promise<boolean> {
    return this.patch_records(recordIds.map((id) => ({ id, notification_sent: true })));
  }

  async get_statistics(): Promise<Statistics> {
    const today = new Date().toISOString().slice(0, 10);
    const [total, critical, high, medium, low, unsent, todayCount, byRisk, byDisease, scanRuns] = await Promise.all([
      this.countFindings(["approved = 1"]),
      this.countFindings(["approved = 1", "risk = ?"], ["critical"]),
      this.countFindings(["approved = 1", "risk = ?"], ["high"]),
      this.countFindings(["approved = 1", "risk = ?"], ["medium"]),
      this.countFindings(["approved = 1", "risk = ?"], ["low"]),
      this.countFindings(["approved = 1", "notification_sent = 0"]),
      this.countFindings(["approved = 1", "publication_date = ?"], [today]),
      this.db.prepare("select coalesce(risk, 'unknown') as risk, count(*) as count from findings where approved = 1 group by coalesce(risk, 'unknown') order by count desc").all(),
      this.db.prepare("select disease, count(*) as count from findings where approved = 1 group by disease order by count desc limit 20").all(),
      this.db.prepare("select status, count(*) as count from scan_runs group by status order by count desc").all(),
    ]);

    return {
      total_findings: total,
      total_critical: critical,
      total_high: high,
      total_medium: medium,
      total_low: low,
      unsent_count: unsent,
      today_count: todayCount,
      generated_at: new Date().toISOString(),
      by_risk: byRisk.results ?? [],
      by_disease: byDisease.results ?? [],
      scan_runs: scanRuns.results ?? [],
    };
  }

  async get_finding_by_id(recordId: number | string): Promise<FindingRecord | null> {
    const id = toSafeId(recordId);
    if (id === null) return null;
    return this.db.prepare("select * from findings where id = ? and approved = 1").bind(id).first<FindingRecord>();
  }

  async check_duplicate_by_hash(contentHash: string): Promise<boolean> {
    if (!contentHash) return false;
    const row = await this.db.prepare("select id from findings where content_hash = ? limit 1").bind(contentHash).first<{ id: number }>();
    return row !== null;
  }

  async query_headlines_by_source(source: string, limit = 2000): Promise<string[]> {
    const rows = await this.query_findings({ source, limit, sort: "-publication_date" });
    return rows.map((row) => row.headline).filter((headline) => typeof headline === "string" && headline.trim().length > 0);
  }

  async create_quarantine_record(finding: FindingInput, reason: string, source: string, sourceType: string, stage: string): Promise<Record<string, unknown> | null> {
    const now = new Date().toISOString();
    const headline = text(finding.headline) || text(finding.title);
    const publicationDate = text(finding.publication_date) || text(finding.date) || now.slice(0, 10);
    const disease = text(finding.disease) || "news";
    const sourceId = text(finding.source_id) || null;
    const quarantineKey = await sha256Hex(`${source}|${sourceType}|${stage}|${publicationDate}|${headline}|${reason}`);

    const result = await this.db.prepare(
      `insert or ignore into quarantine_findings (quarantine_key, source_id, source, source_type, stage, reason, disease, headline, publication_date, payload_r2_key, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(quarantineKey.slice(0, 64), sourceId, source, sourceType, stage, reason.slice(0, 255), disease, headline, publicationDate, text(finding.payload_r2_key), now).run();

    if ((result.meta?.changes ?? 0) === 0) return null;
    return this.db.prepare("select * from quarantine_findings where quarantine_key = ?").bind(quarantineKey.slice(0, 64)).first();
  }

  private async getByColumn(column: "content_hash", value: string): Promise<FindingRecord | null> {
    return this.db.prepare(`select * from findings where ${column} = ?`).bind(value).first<FindingRecord>();
  }

  private async countFindings(where: string[], params: D1Value[] = []): Promise<number> {
    const row = await this.db.prepare(`select count(*) as count from findings where ${where.join(" and ")}`).bind(...params).first<{ count: number }>();
    return Number(row?.count ?? 0);
  }

  private mapFinding(finding: FindingInput, now: string): Record<(typeof FINDING_COLUMNS)[number], D1Value> {
    const rawUrl = text(finding.url);
    const rawSourceLink = text(finding.source_link);
    return {
      disease: text(finding.disease) || "Unknown",
      source: text(finding.source),
      source_id: text(finding.source_id) || null,
      source_type: text(finding.source_type) || "changedetection",
      source_link: rawSourceLink || rawUrl,
      publication_date: text(finding.publication_date) || now.slice(0, 10),
      headline: text(finding.headline),
      short_description_en: text(finding.short_description_en) || text(finding.summary),
      detailed_description_en: text(finding.detailed_description_en),
      short_description_ar: text(finding.short_description_ar),
      detailed_description_ar: text(finding.detailed_description_ar),
      content_hash: text(finding.content_hash) || null,
      risk: text(finding.risk) || text(finding.priority) || "medium",
      risk_assessment: text(finding.risk_assessment),
      countries_json: jsonArrayText(finding.countries_json ?? finding.countries),
      regions_json: jsonArrayText(finding.regions_json ?? finding.regions),
      notification_sent: booleanInt(finding.notification_sent),
      approved: finding.approved === false ? 0 : 1,
      source_snapshot_id: toNullableNumber(finding.source_snapshot_id),
      parser_payload_r2_key: text(finding.parser_payload_r2_key),
    };
  }
}

export function createD1Storage(db: D1DatabaseLike): D1StorageAdapter {
  return new D1StorageAdapter(db);
}

function buildFindingWhere(options: QueryFindingsOptions): { where: string[]; params: D1Value[] } {
  const where = ["approved = ?"];
  const params: D1Value[] = [options.approved === false ? 0 : 1];
  addTextWhere(where, params, "disease", options.disease);
  addTextWhere(where, params, "source", options.source);
  addTextWhere(where, params, "source_id", options.source_id);
  addTextWhere(where, params, "risk", options.risk);
  addTextWhere(where, params, "content_hash", options.content_hash);
  addTextWhere(where, params, "publication_date", options.publication_date);
  if (options.publication_date_from) {
    where.push("publication_date >= ?");
    params.push(options.publication_date_from);
  }
  if (typeof options.notification_sent === "boolean") {
    where.push("notification_sent = ?");
    params.push(options.notification_sent ? 1 : 0);
  }
  return { where, params };
}

function addTextWhere(where: string[], params: D1Value[], column: string, value: string | undefined): void {
  const safeValue = safeText(value, 240);
  if (!safeValue) return;
  where.push(`${column} = ?`);
  params.push(safeValue);
}

function sortSql(sort: QueryFindingsOptions["sort"]): string {
  switch (sort) {
    case "publication_date": return "order by coalesce(publication_date, created_at) asc, id asc";
    case "created_at": return "order by created_at asc, id asc";
    case "-created_at": return "order by created_at desc, id desc";
    case "id": return "order by id asc";
    case "-id": return "order by id desc";
    case "-publication_date":
    default: return "order by coalesce(publication_date, created_at) desc, id desc";
  }
}

function normalizeField(key: string, value: unknown): D1Value {
  if (key === "notification_sent" || key === "approved") return booleanInt(value);
  if (key === "countries_json" || key === "regions_json") return jsonArrayText(value);
  if (key === "source_snapshot_id") return toNullableNumber(value);
  return toD1Value(value);
}

function toD1Value(value: unknown): D1Value {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

function safeText(value: string | undefined, maxLength: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function booleanInt(value: unknown): number {
  return value === true || value === 1 || value === "true" ? 1 : 0;
}

function jsonArrayText(value: unknown): string {
  if (typeof value === "string") return value || "[]";
  if (Array.isArray(value)) return JSON.stringify(value);
  return "[]";
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function toSafeId(value: number | string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, Number(value)));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
