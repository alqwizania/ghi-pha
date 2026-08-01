import puppeteer, { type BrowserWorker } from "@cloudflare/puppeteer";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createD1Storage, type D1DatabaseLike, type FindingInput } from "./storage";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type D1Database = D1DatabaseLike;

interface R2ObjectBody {
  text(): Promise<string>;
}

interface R2ListedObject {
  key: string;
  uploaded: Date;
}

interface R2ListResult {
  objects: R2ListedObject[];
  truncated: boolean;
  cursor?: string;
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: { httpMetadata?: Record<string, string> }): Promise<unknown>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<R2ListResult>;
  delete(keys: string | string[]): Promise<void>;
}

interface Queue<T = unknown> {
  send(message: T): Promise<void>;
}

interface QueueMessage<T = unknown> {
  body: T;
  ack(): void;
  retry(): void;
}

interface MessageBatch<T = unknown> {
  queue: string;
  messages: QueueMessage<T>[];
}

interface ScheduledController {
  scheduledTime: number;
  cron: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface Env {
  DB: D1Database;
  ARTIFACTS: R2Bucket;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  BROWSER?: BrowserWorker;
  SOURCE_SCAN_QUEUE?: Queue<SourceScanJob>;
  FINDING_PROCESS_QUEUE?: Queue<FindingProcessJob>;
  DEAD_LETTER_QUEUE?: Queue<unknown>;
  OPENROUTER_API_KEY?: string;
  ADMIN_API_TOKEN?: string;
  OPENROUTER_BASE_URL?: string;
  OPENROUTER_MODEL?: string;
}

type SourceRow = {
  id: string;
  name: string;
  type: string;
  url: string | null;
  parser: string | null;
  enabled: number;
  check_interval_seconds: number;
  tags_json: string | null;
  config_json: string | null;
  last_content_hash?: string | null;
};

type SnapshotRow = {
  id: number;
  source_id: string;
  content_hash: string;
  snapshot_kind: string;
  r2_key: string;
  snapshot_excerpt?: string | null;
  fetched_at?: string | null;
  status_code?: number | null;
};

type SourceScanJob = {
  job_type: "source-scan";
  event_key: string;
  source_id: string;
  scan_run_id: string;
  queued_at: string;
  force?: boolean;
};

type FindingProcessJob = {
  job_type: "finding-process";
  event_key: string;
  source_id: string;
  snapshot_id: number;
  scan_run_id: string;
  r2_key: string;
  content_hash: string;
  queued_at: string;
};

type ParsedFinding = {
  headline: string;
  disease: string;
  publication_date: string | null;
  short_description_en: string;
  source_link: string | null;
};

type AnalyzedFinding = ParsedFinding & {
  detailed_description_en: string;
  short_description_ar: string;
  detailed_description_ar: string;
  risk: string;
  risk_assessment: string;
  countries: string[];
  regions: string[];
};

type OpenRouterChatResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
};

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const CACHE_HEADERS = { "cache-control": "public, max-age=60, stale-while-revalidate=300" };
const PRIVATE_HEADERS = { "cache-control": "no-store" };
const MAX_FETCH_BYTES = 2_000_000;
const DAY_MS = 86_400_000;
const R2_RETENTION_RULES = [
  { prefix: "snapshots/", days: 90 },
  { prefix: "rendered/", days: 90 },
  { prefix: "pdfs/", days: 180 },
  { prefix: "parser-payloads/", days: 30 },
  { prefix: "parser-runs/", days: 30 },
  { prefix: "screenshots/", days: 30 },
  { prefix: "traces/", days: 14 },
  { prefix: "digests/", days: 365 },
] as const;
const R2_CLEANUP_MAX_DELETES = 500;
const R2_CLEANUP_LIST_LIMIT = 100;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);

    try {
      if (url.pathname === "/status") return status(env);
      if (url.pathname === "/api/admin/dead-letter") return deadLetterInspection(request, url, env);
      if (url.pathname === "/api/stats") return stats(env);
      if (url.pathname === "/api/scan-health") return scanHealth(env);
      if (url.pathname === "/api/findings") return findings(url, env);
      if (url.pathname.startsWith("/api/findings/")) return findingById(url, env);
      if (url.pathname === "/api/sources") return sources(env);
      if (url.pathname === "/api/diseases") return diseases(env);
      if (isFrontendRoute(url.pathname)) return serveIndex(request, env);
      return json({ error: "not_found" }, 404);
    } catch (error) {
      console.error(JSON.stringify({ level: "error", message: "request_failed", error: String(error) }));
      return json({ error: "internal_error" }, 500);
    }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(enqueueDueSources(controller, env));
    if (shouldRunR2Cleanup(controller)) ctx.waitUntil(cleanupR2Artifacts(controller, env));
  },

  async queue(batch: MessageBatch, env: Env, _ctx: ExecutionContext): Promise<void> {
    await Promise.all(batch.messages.map((message) => handleQueueMessage(batch.queue, message, env)));
  },
};

export class ProcessSourceWorkflow extends WorkflowEntrypoint<Env, SourceScanJob | FindingProcessJob> {
  async run(event: WorkflowEvent<SourceScanJob | FindingProcessJob>, step: WorkflowStep): Promise<void> {
    await step.do("process source workflow job", async () => {
      if (event.payload.job_type === "source-scan") {
        await handleSourceScan(event.payload, this.env);
      } else {
        await handleFindingProcess(event.payload, this.env);
      }
    });
  }
}

async function status(env: Env): Promise<Response> {
  const [sourcesCount, findingsCount, lastSnapshot] = await Promise.all([
    count(env, "sources"),
    count(env, "findings", "approved = 1"),
    env.DB.prepare("select max(fetched_at) as last_snapshot_at from source_snapshots").first(),
  ]);
  return json({ ok: true, service: "seharadar-worker", sources: sourcesCount, findings: findingsCount, last_snapshot_at: lastSnapshot?.last_snapshot_at ?? null }, 200, CACHE_HEADERS);
}

async function stats(env: Env): Promise<Response> {
  const [storageStats, activeSources] = await Promise.all([
    createD1Storage(env.DB).get_statistics(),
    count(env, "sources", "enabled = 1"),
  ]);
  return json({ ...storageStats, active_sources: activeSources }, 200, CACHE_HEADERS);
}

async function scanHealth(env: Env): Promise<Response> {
  const now = new Date().toISOString();
  const stalledCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const [runStatuses, eventStatuses, recentRuns, recentEvents, stalledRuns] = await Promise.all([
    env.DB.prepare("select status, count(*) as count from scan_runs group by status order by count desc").all(),
    env.DB.prepare("select event_type, status, count(*) as count from scan_events group by event_type, status order by event_type asc, count desc").all(),
    env.DB.prepare(
      `select r.id, r.source_id, s.name as source_name, r.trigger_type, r.status, r.started_at, r.finished_at,
        r.items_found, r.findings_stored, r.duplicates, r.quarantined
       from scan_runs r left join sources s on s.id = r.source_id
       order by r.started_at desc limit 20`,
    ).all(),
    env.DB.prepare(
      `select e.source_id, s.name as source_name, e.event_type, e.status, e.attempts,
        e.received_at, e.processed_at, e.next_attempt_at
       from scan_events e left join sources s on s.id = e.source_id
       order by e.received_at desc limit 20`,
    ).all(),
    env.DB.prepare(
      "select count(*) as count from scan_runs where status in ('queued', 'processing') and started_at < ?",
    ).bind(stalledCutoff).first<{ count: number }>(),
  ]);

  return json({
    generated_at: now,
    stalled_cutoff: stalledCutoff,
    stalled_runs: Number(stalledRuns?.count ?? 0),
    scan_runs: runStatuses.results ?? [],
    scan_events: eventStatuses.results ?? [],
    recent_runs: recentRuns.results ?? [],
    recent_events: recentEvents.results ?? [],
  }, 200, CACHE_HEADERS);
}

async function deadLetterInspection(request: Request, url: URL, env: Env): Promise<Response> {
  const auth = requireAdmin(request, env);
  if (auth) return auth;

  const now = new Date().toISOString();
  const limit = clampInt(url.searchParams.get("limit"), 25, 1, 100);
  const stalledCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const [events, runs] = await Promise.all([
    env.DB.prepare(
      `select e.id, e.event_key, e.source_id, s.name as source_name, e.event_type, e.status,
        e.attempts, e.next_attempt_at, e.received_at, e.processed_at, e.error, e.payload_json
       from scan_events e left join sources s on s.id = e.source_id
       where e.status in ('failed', 'error', 'dead-letter') or e.error is not null
         or (e.status in ('pending', 'processing') and e.received_at < ?)
       order by coalesce(e.processed_at, e.received_at) desc limit ?`,
    ).bind(stalledCutoff, limit).all(),
    env.DB.prepare(
      `select r.id, r.source_id, s.name as source_name, r.trigger_type, r.status,
        r.started_at, r.finished_at, r.error, r.metadata_json
       from scan_runs r left join sources s on s.id = r.source_id
       where r.status in ('failed', 'error') or r.error is not null
         or (r.status in ('queued', 'processing') and r.started_at < ?)
       order by r.started_at desc limit ?`,
    ).bind(stalledCutoff, limit).all(),
  ]);

  return json({
    generated_at: now,
    limit,
    stalled_cutoff: stalledCutoff,
    limitation: "Cloudflare Queues dead-letter messages are not introspectable from Worker runtime; this endpoint reports D1-backed failed or stalled scan_events and scan_runs.",
    scan_events: events.results ?? [],
    scan_runs: runs.results ?? [],
  }, 200, PRIVATE_HEADERS);
}

async function findings(url: URL, env: Env): Promise<Response> {
  const limit = clampInt(url.searchParams.get("limit"), 25, 1, 1000);
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 100_000);
  const rows = await createD1Storage(env.DB).query_findings({
    disease: safeText(url.searchParams.get("disease"), 80) ?? undefined,
    source_id: safeText(url.searchParams.get("source"), 80) ?? undefined,
    risk: safeText(url.searchParams.get("risk"), 80) ?? undefined,
    publication_date_from: safeText(url.searchParams.get("date"), 40) ?? undefined,
    limit,
    offset,
  });
  return json({ findings: rows, limit, offset }, 200, CACHE_HEADERS);
}

async function findingById(url: URL, env: Env): Promise<Response> {
  const id = Number(url.pathname.split("/").pop());
  if (!Number.isSafeInteger(id) || id < 1) return json({ error: "invalid_id" }, 400);
  const row = await createD1Storage(env.DB).get_finding_by_id(id);
  return row ? json(row, 200, CACHE_HEADERS) : json({ error: "not_found" }, 404);
}

async function sources(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    `select s.id, s.name, s.type, s.url, s.parser, s.enabled, s.check_interval_seconds,
      s.tags_json, st.last_checked_at, st.next_check_at, st.last_changed_at, st.last_success_at,
      st.consecutive_failures
     from sources s left join source_state st on st.source_id = s.id
     order by s.enabled desc, s.name asc`,
  ).all();
  return json({ sources: result.results ?? [] }, 200, CACHE_HEADERS);
}

async function diseases(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    "select disease, count(*) as findings_count, max(publication_date) as latest_publication_date from findings where approved = 1 group by disease order by findings_count desc, disease asc",
  ).all();
  return json({ diseases: result.results ?? [] }, 200, CACHE_HEADERS);
}

async function serveIndex(request: Request, env: Env): Promise<Response> {
  if (env.ASSETS) {
    const url = new URL(request.url);
    url.pathname = "/index.html";
    url.search = "";
    return env.ASSETS.fetch(new Request(url, request));
  }
  return new Response("SehaRadar Worker is running. Configure static assets to serve the public UI.", { headers: { "content-type": "text/plain; charset=utf-8" } });
}

function isFrontendRoute(pathname: string): boolean {
  return pathname === "/" || pathname === "/index.html" || pathname === "/globe" || pathname === "/globe/" || pathname === "/map/outbreaks" || pathname === "/map/outbreaks/";
}

async function enqueueDueSources(controller: ScheduledController, env: Env): Promise<void> {
  if (!env.SOURCE_SCAN_QUEUE) throw new Error("SOURCE_SCAN_QUEUE binding is required");
  const now = new Date(controller.scheduledTime || Date.now()).toISOString();
  const due = await env.DB.prepare(
    `select s.id from sources s left join source_state st on st.source_id = s.id
     where s.enabled = 1 and (st.next_check_at is null or st.next_check_at <= ?)
     order by s.priority_boost desc, st.next_check_at asc limit 50`,
  ).bind(now).all<{ id: string }>();

  for (const source of due.results ?? []) {
    const eventKey = `${source.id}:scheduled:${now.slice(0, 16)}`;
    const scanRunId = eventKey;
    const created = await env.DB.prepare(
      `insert or ignore into scan_events (event_key, source_id, event_type, status, attempts, next_attempt_at, payload_json, received_at)
       values (?, ?, 'source-scan', 'pending', 0, ?, ?, ?)`,
    ).bind(eventKey, source.id, now, JSON.stringify({ cron: controller.cron }), now).run();
    if ((created.meta?.changes ?? 0) === 0) continue;

    await env.DB.prepare(
      `insert or ignore into scan_runs (id, source_id, trigger_type, status, started_at, metadata_json)
       values (?, ?, 'scheduled', 'queued', ?, ?)`,
    ).bind(scanRunId, source.id, now, JSON.stringify({ event_key: eventKey })).run();
    await env.SOURCE_SCAN_QUEUE.send({ job_type: "source-scan", event_key: eventKey, source_id: source.id, scan_run_id: scanRunId, queued_at: now });
  }
}

function shouldRunR2Cleanup(controller: ScheduledController): boolean {
  const scheduledAt = new Date(controller.scheduledTime || Date.now());
  return scheduledAt.getUTCHours() === 3 && scheduledAt.getUTCMinutes() < 15;
}

async function cleanupR2Artifacts(controller: ScheduledController, env: Env): Promise<void> {
  const nowMs = controller.scheduledTime || Date.now();
  let deleted = 0;

  for (const rule of R2_RETENTION_RULES) {
    let cursor: string | undefined;
    const cutoffMs = nowMs - rule.days * DAY_MS;

    do {
      const page = await env.ARTIFACTS.list({ prefix: rule.prefix, cursor, limit: R2_CLEANUP_LIST_LIMIT });
      const expired = page.objects
        .filter((object) => object.uploaded.getTime() < cutoffMs)
        .map((object) => object.key)
        .slice(0, R2_CLEANUP_MAX_DELETES - deleted);

      if (expired.length > 0) {
        await env.ARTIFACTS.delete(expired);
        deleted += expired.length;
      }

      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor && deleted < R2_CLEANUP_MAX_DELETES);

    if (deleted >= R2_CLEANUP_MAX_DELETES) break;
  }

  console.log(JSON.stringify({ level: "info", message: "r2_retention_cleanup_completed", deleted }));
}

async function handleQueueMessage(queueName: string, message: QueueMessage, env: Env): Promise<void> {
  const body = message.body as Partial<SourceScanJob> | Partial<FindingProcessJob>;
  try {
    if (queueName === "source-scan-jobs" || body.job_type === "source-scan") {
      await handleSourceScan(body as SourceScanJob, env);
    } else if (queueName === "finding-process-jobs" || body.job_type === "finding-process") {
      await handleFindingProcess(body as FindingProcessJob, env);
    } else {
      throw new Error(`unsupported queue message: ${queueName}`);
    }
    message.ack();
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "queue_message_failed", queue: queueName, error: String(error) }));
    await recordQueueFailure(env, body, error);
    message.retry();
  }
}

async function handleSourceScan(job: SourceScanJob, env: Env): Promise<void> {
  if (!env.FINDING_PROCESS_QUEUE) throw new Error("FINDING_PROCESS_QUEUE binding is required");
  const now = new Date().toISOString();
  await markEvent(env, job.event_key, "processing", now);
  await env.DB.prepare("update scan_runs set status = 'processing' where id = ?").bind(job.scan_run_id).run();

  const source = await env.DB.prepare(
    `select s.*, st.last_content_hash from sources s left join source_state st on st.source_id = s.id where s.id = ? and s.enabled = 1`,
  ).bind(job.source_id).first<SourceRow>();
  if (!source?.url) throw new Error(`source not found or missing url: ${job.source_id}`);

  const fetched = await fetchSource(source, env);
  const normalized = normalizeContent(fetched.body);
  const contentHash = await sha256Hex(normalized);
  const nextCheckAt = nextCheck(now, source.check_interval_seconds);

  if (!job.force && source.last_content_hash === contentHash) {
    await env.DB.prepare(
      `insert into source_state (source_id, last_checked_at, next_check_at, last_success_at, consecutive_failures)
       values (?, ?, ?, ?, 0)
       on conflict(source_id) do update set last_checked_at = excluded.last_checked_at,
         next_check_at = excluded.next_check_at, last_success_at = excluded.last_success_at,
         consecutive_failures = 0, last_error = null`,
    ).bind(source.id, now, nextCheckAt, now).run();
    await markEvent(env, job.event_key, "done", now);
    await env.DB.prepare("update scan_runs set status = 'done', finished_at = ? where id = ?").bind(now, job.scan_run_id).run();
    return;
  }

  const snapshotKind = fetched.rendered ? "rendered" : "raw";
  const r2Key = `${snapshotKind === "rendered" ? "rendered" : "snapshots"}/${source.id}/${now.slice(0, 4)}/${now.slice(5, 7)}/${now.slice(8, 10)}/${contentHash}.html`;
  await env.ARTIFACTS.put(r2Key, fetched.body, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  await env.DB.prepare(
    `insert or ignore into source_snapshots (source_id, content_hash, snapshot_kind, r2_key, snapshot_excerpt, fetched_at, status_code, metadata_json)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(source.id, contentHash, snapshotKind, r2Key, normalized.slice(0, 500), now, fetched.status, JSON.stringify({ url: source.url })).run();
  const snapshot = await env.DB.prepare(
    "select id, source_id, content_hash, snapshot_kind, r2_key from source_snapshots where source_id = ? and content_hash = ? and snapshot_kind = ?",
  ).bind(source.id, contentHash, snapshotKind).first<SnapshotRow>();
  if (!snapshot) throw new Error("snapshot insert failed");

  await env.DB.prepare(
    `insert into source_state (source_id, last_checked_at, next_check_at, last_content_hash, last_changed_at, last_success_at, consecutive_failures)
     values (?, ?, ?, ?, ?, ?, 0)
     on conflict(source_id) do update set last_checked_at = excluded.last_checked_at,
       next_check_at = excluded.next_check_at, last_content_hash = excluded.last_content_hash,
       last_changed_at = excluded.last_changed_at, last_success_at = excluded.last_success_at,
       consecutive_failures = 0, last_error = null`,
  ).bind(source.id, now, nextCheckAt, contentHash, now, now).run();

  const processJob: FindingProcessJob = {
    job_type: "finding-process",
    event_key: `${source.id}:${contentHash}`,
    source_id: source.id,
    snapshot_id: snapshot.id,
    scan_run_id: job.scan_run_id,
    r2_key: r2Key,
    content_hash: contentHash,
    queued_at: now,
  };
  const processEvent = await env.DB.prepare(
    `insert or ignore into scan_events (event_key, source_id, event_type, status, attempts, next_attempt_at, payload_json, received_at)
     values (?, ?, 'finding-process', 'pending', 0, ?, ?, ?)`,
  ).bind(processJob.event_key, source.id, now, JSON.stringify(processJob), now).run();
  if ((processEvent.meta?.changes ?? 0) > 0) await env.FINDING_PROCESS_QUEUE.send(processJob);
  await markEvent(env, job.event_key, "done", now);
}

async function handleFindingProcess(job: FindingProcessJob, env: Env): Promise<void> {
  const now = new Date().toISOString();
  await markEvent(env, job.event_key, "processing", now);

  const [source, snapshot, artifact] = await Promise.all([
    env.DB.prepare("select * from sources where id = ?").bind(job.source_id).first<SourceRow>(),
    env.DB.prepare("select * from source_snapshots where id = ?").bind(job.snapshot_id).first<SnapshotRow>(),
    env.ARTIFACTS.get(job.r2_key),
  ]);
  if (!source || !snapshot || !artifact) throw new Error("missing processing input");

  const html = await artifact.text();
  const parsed = parseFindings(source, html).slice(0, 25);
  const parserPayloadKey = `parser-payloads/${source.id}/${snapshot.content_hash}.json`;
  const parserPayload = {
    generated_at: now,
    source: {
      id: source.id,
      name: source.name,
      type: source.type,
      url: source.url,
      parser: source.parser ?? "generic",
    },
    input: {
      snapshot_id: snapshot.id,
      snapshot_r2_key: snapshot.r2_key,
      snapshot_kind: snapshot.snapshot_kind,
      content_hash: snapshot.content_hash,
      fetched_at: snapshot.fetched_at ?? null,
      status_code: snapshot.status_code ?? null,
      excerpt: snapshot.snapshot_excerpt ?? html.slice(0, 500),
    },
    output: {
      parser: source.parser ?? "generic",
      findings_count: parsed.length,
      findings: parsed,
    },
    findings: parsed,
  };
  await env.ARTIFACTS.put(parserPayloadKey, JSON.stringify(parserPayload), { httpMetadata: { contentType: "application/json; charset=utf-8" } });

  let stored = 0;
  let duplicates = 0;
  let quarantined = 0;
  const storage = createD1Storage(env.DB);

  for (const parsedFinding of parsed) {
    const quality = qualityGate(parsedFinding);
    const findingHash = await sha256Hex(`${source.id}\n${parsedFinding.headline}\n${parsedFinding.publication_date ?? ""}`);
    if (!quality.ok) {
      const row = await storage.create_quarantine_record({ ...parsedFinding, source_id: source.id, payload_r2_key: parserPayloadKey }, quality.reason, source.name, source.type, "parser-quality");
      quarantined += row ? 1 : 0;
      continue;
    }

    if (await storage.check_duplicate_by_hash(findingHash)) {
      duplicates += 1;
      continue;
    }

    const analyzedFinding = await analyzeAndTranslateFinding(source, parsedFinding, env);
    const row = await storage.create_finding_v3({
      ...(analyzedFinding as FindingInput),
      source: source.name,
      source_id: source.id,
      source_type: source.type,
      content_hash: findingHash,
      source_snapshot_id: snapshot.id,
      parser_payload_r2_key: parserPayloadKey,
    });
    if (row) stored += 1;
    else duplicates += 1;
  }

  await env.DB.prepare(
    `update scan_runs set status = 'done', finished_at = ?, items_found = ?, findings_stored = ?, duplicates = ?, quarantined = ? where id = ?`,
  ).bind(now, parsed.length, stored, duplicates, quarantined, job.scan_run_id).run();
  await markEvent(env, job.event_key, "done", now);
}

async function fetchSource(source: SourceRow, env: Env): Promise<{ body: string; status: number; rendered: boolean }> {
  if (shouldRenderSource(source)) return renderSource(source, env);

  if (!source.url) throw new Error(`source is missing url: ${source.id}`);
  const response = await fetch(source.url, {
    headers: { "user-agent": "SehaRadar/1.0 (+https://github.com/FayaaDev/SehaRadar)" },
  });
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_FETCH_BYTES) throw new Error("source response too large");
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_FETCH_BYTES) throw new Error("source response too large");
  return { body: new TextDecoder().decode(buffer), status: response.status, rendered: false };
}

async function renderSource(source: SourceRow, env: Env): Promise<{ body: string; status: number; rendered: boolean }> {
  if (!source.url) throw new Error(`source is missing url: ${source.id}`);
  if (!env.BROWSER) throw new Error(`BROWSER binding is required for rendered source: ${source.id}`);

  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    const response = await page.goto(source.url, { waitUntil: "networkidle0" });
    const body = await page.content();
    if (body.length > MAX_FETCH_BYTES) throw new Error("rendered source response too large");
    return { body, status: response?.status() ?? 200, rendered: true };
  } finally {
    await browser.close();
  }
}

function shouldRenderSource(source: SourceRow): boolean {
  const config = parseConfig(source.config_json);
  const tags = parseJsonArray(source.tags_json).map(String);
  return config.rendered === true || config.requires_browser === true || config.use_browser === true || tags.includes("dashboard");
}

function parseFindings(source: SourceRow, html: string): ParsedFinding[] {
  const parser = (source.parser ?? "generic").toLowerCase();
  const text = stripHtml(html);
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: absolutize(String(match[1]), source.url), title: cleanText(stripHtml(String(match[2]))) }))
    .filter((item) => item.title.length >= 12 && !isBoilerplate(item.title));
  const candidates = links.length > 0 ? links.slice(0, 20) : text.split("\n").map((line) => ({ href: source.url, title: cleanText(line) })).filter((item) => item.title.length >= 20).slice(0, 20);

  return candidates.map((item) => ({
    headline: item.title.slice(0, 240),
    disease: inferDisease(item.title),
    publication_date: extractDate(item.title) ?? extractDate(text),
    short_description_en: `${source.name}: ${item.title}`.slice(0, 500),
    source_link: item.href,
  })).filter((finding, index, all) => all.findIndex((other) => other.headline === finding.headline) === index)
    .filter((finding) => parser.includes("who") || parser.includes("cdc") || parser.includes("generic") || finding.headline.length > 0);
}

function qualityGate(finding: ParsedFinding): { ok: true } | { ok: false; reason: string } {
  if (finding.headline.length < 12) return { ok: false, reason: "headline_too_short" };
  if (isBoilerplate(finding.headline)) return { ok: false, reason: "boilerplate" };
  if (finding.short_description_en.length < 20) return { ok: false, reason: "description_too_short" };
  return { ok: true };
}

async function analyzeAndTranslateFinding(source: SourceRow, finding: ParsedFinding, env: Env): Promise<AnalyzedFinding> {
  if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY secret is required for finding analysis");

  const prompt = `Analyze this public-health surveillance finding and translate the English descriptions into Modern Standard Arabic.

Return only a valid JSON object with these exact keys:
{
  "disease": "canonical disease name or news",
  "short_description_en": "1-2 sentence epidemiological summary",
  "detailed_description_en": "2-4 paragraph epidemiological analysis covering who/where/when, counts if known, interventions, and uncertainty",
  "short_description_ar": "Arabic translation of short_description_en",
  "detailed_description_ar": "Arabic translation of detailed_description_en",
  "risk": "critical|high|medium|low|unknown",
  "risk_assessment": "brief rationale for the risk level",
  "countries": ["country names"],
  "regions": ["region names"]
}

Rules:
- Use source text only; do not invent case counts, locations, or dates.
- Keep Arabic medically accurate and formal.
- Use "news" when no specific disease or outbreak is identifiable.
- Use "unknown" risk only when the text lacks enough epidemiological context.

SOURCE: ${source.name}
SOURCE_TYPE: ${source.type}
HEADLINE: ${finding.headline}
PUBLICATION_DATE: ${finding.publication_date ?? "unknown"}
SOURCE_LINK: ${finding.source_link ?? "unknown"}
PARSER_DISEASE_HINT: ${finding.disease}
PARSER_DESCRIPTION: ${finding.short_description_en}`;

  const content = await openRouterJson(env, prompt);
  const parsed = parseAnalysisJson(content);
  const disease = stringField(parsed.disease) || finding.disease || "news";
  const shortDescriptionEn = stringField(parsed.short_description_en) || finding.short_description_en;
  const detailedDescriptionEn = stringField(parsed.detailed_description_en) || shortDescriptionEn;

  return {
    ...finding,
    disease,
    short_description_en: shortDescriptionEn,
    detailed_description_en: detailedDescriptionEn,
    short_description_ar: stringField(parsed.short_description_ar),
    detailed_description_ar: stringField(parsed.detailed_description_ar),
    risk: normalizeRisk(stringField(parsed.risk)),
    risk_assessment: stringField(parsed.risk_assessment),
    countries: stringArrayField(parsed.countries),
    regions: stringArrayField(parsed.regions),
  };
}

async function openRouterJson(env: Env, prompt: string): Promise<string> {
  const baseUrl = (env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
      messages: [
        { role: "system", content: "You are an epidemiological surveillance analyst and professional Arabic medical translator. Always respond with valid JSON only." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) throw new Error(`OpenRouter analysis failed: ${response.status} ${await response.text()}`.slice(0, 500));
  const payload = await response.json<OpenRouterChatResponse>();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter analysis returned empty content");
  return content;
}

function parseAnalysisJson(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    }
  }
  throw new Error("OpenRouter analysis returned invalid JSON");
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArrayField(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringField).filter(Boolean).slice(0, 20) : [];
}

function normalizeRisk(value: string): string {
  const risk = value.toLowerCase();
  return risk === "critical" || risk === "high" || risk === "medium" || risk === "low" || risk === "unknown" ? risk : "unknown";
}

async function markEvent(env: Env, eventKey: string, status: string, when: string): Promise<void> {
  await env.DB.prepare("update scan_events set status = ?, attempts = attempts + case when ? = 'processing' then 1 else 0 end, processed_at = ? where event_key = ?")
    .bind(status, status, when, eventKey).run();
}

async function recordQueueFailure(env: Env, job: Partial<SourceScanJob> | Partial<FindingProcessJob>, error: unknown): Promise<void> {
  const now = new Date().toISOString();
  const errorText = String(error).slice(0, 1000);
  if (job.event_key) {
    await env.DB.prepare("update scan_events set status = 'failed', error = ?, processed_at = ? where event_key = ?")
      .bind(errorText, now, job.event_key).run();
  }
  if (job.scan_run_id) {
    await env.DB.prepare("update scan_runs set status = 'failed', error = ?, finished_at = ? where id = ?")
      .bind(errorText, now, job.scan_run_id).run();
  }
}

function requireAdmin(request: Request, env: Env): Response | null {
  if (!env.ADMIN_API_TOKEN) return json({ error: "admin_token_not_configured" }, 503, PRIVATE_HEADERS);
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const token = bearer || request.headers.get("x-admin-token")?.trim();
  return token && timingSafeEqual(token, env.ADMIN_API_TOKEN) ? null : json({ error: "unauthorized" }, 401, PRIVATE_HEADERS);
}

function timingSafeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let diff = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);

  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
}

async function count(env: Env, table: string, where = "1 = 1"): Promise<number> {
  const row = await env.DB.prepare(`select count(*) as count from ${table} where ${where}`).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

function safeText(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function json(body: JsonValue | Record<string, unknown>, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function normalizeContent(content: string): string {
  return cleanText(content.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")).slice(0, MAX_FETCH_BYTES);
}

function stripHtml(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, "\n");
}

function cleanText(value: string): string {
  return value.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function isBoilerplate(value: string): boolean {
  return /^(home|menu|search|subscribe|privacy|cookies|contact|about|read more)$/i.test(value.trim()) || /^skip\b/i.test(value.trim());
}

function inferDisease(value: string): string {
  const known = ["cholera", "mpox", "measles", "dengue", "ebola", "influenza", "covid", "polio", "malaria", "yellow fever"];
  const lower = value.toLowerCase();
  return known.find((name) => lower.includes(name)) ?? "unknown";
}

function extractDate(value: string): string | null {
  const iso = value.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const named = value.match(/\b(\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2})\b/i);
  if (named) return new Date(named[1]).toISOString().slice(0, 10);
  const us = value.match(/\b((January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2})\b/i);
  if (us) return new Date(us[1]).toISOString().slice(0, 10);
  return null;
}

function absolutize(href: string, base: string | null): string | null {
  try {
    return new URL(href, base ?? undefined).toString();
  } catch {
    return null;
  }
}

function parseConfig(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function nextCheck(now: string, intervalSeconds: number): string {
  return new Date(new Date(now).getTime() + Math.max(60, intervalSeconds || 3600) * 1000).toISOString();
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
