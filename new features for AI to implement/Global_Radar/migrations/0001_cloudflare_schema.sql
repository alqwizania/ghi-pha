-- Cloudflare D1 schema for the Cloudflare-only SehaRadar deployment.
-- D1 uses SQLite semantics; timestamps are stored as ISO-8601 UTC text.

create table if not exists sources (
  id text primary key,
  name text not null,
  type text not null,
  url text,
  parser text,
  enabled integer not null default 1 check (enabled in (0, 1)),
  check_interval_seconds integer not null default 3600 check (check_interval_seconds > 0),
  priority_boost integer not null default 0,
  tags_json text,
  config_json text,
  legacy_watch_uuid text,
  created_at text not null,
  updated_at text not null,
  unique (legacy_watch_uuid)
);

create table if not exists source_state (
  source_id text primary key references sources(id) on delete cascade,
  last_checked_at text,
  next_check_at text,
  last_content_hash text,
  last_changed_at text,
  last_success_at text,
  last_error text,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0)
);

create table if not exists source_snapshots (
  id integer primary key autoincrement,
  source_id text not null references sources(id) on delete cascade,
  content_hash text not null,
  snapshot_kind text not null,
  r2_key text not null,
  snapshot_excerpt text,
  fetched_at text not null,
  status_code integer,
  metadata_json text,
  unique (source_id, content_hash, snapshot_kind),
  unique (r2_key)
);

create table if not exists scan_runs (
  id text primary key,
  source_id text references sources(id) on delete set null,
  trigger_type text not null,
  status text not null,
  started_at text not null,
  finished_at text,
  items_found integer not null default 0 check (items_found >= 0),
  findings_stored integer not null default 0 check (findings_stored >= 0),
  duplicates integer not null default 0 check (duplicates >= 0),
  quarantined integer not null default 0 check (quarantined >= 0),
  error text,
  metadata_json text
);

create table if not exists scan_events (
  id integer primary key autoincrement,
  event_key text unique not null,
  source_id text not null references sources(id) on delete cascade,
  event_type text not null,
  status text not null,
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at text,
  payload_json text,
  error text,
  received_at text not null,
  processed_at text
);

create table if not exists findings (
  id integer primary key autoincrement,
  disease text not null,
  source text not null,
  source_id text references sources(id) on delete set null,
  source_type text,
  source_link text,
  publication_date text,
  headline text not null,
  short_description_en text,
  detailed_description_en text,
  short_description_ar text,
  detailed_description_ar text,
  content_hash text unique,
  risk text,
  risk_assessment text,
  countries_json text,
  regions_json text,
  notification_sent integer not null default 0 check (notification_sent in (0, 1)),
  approved integer not null default 1 check (approved in (0, 1)),
  source_snapshot_id integer references source_snapshots(id) on delete set null,
  parser_payload_r2_key text,
  created_at text not null,
  updated_at text not null
);

create table if not exists quarantine_findings (
  id integer primary key autoincrement,
  quarantine_key text unique not null,
  source_id text references sources(id) on delete set null,
  source text,
  source_type text,
  stage text not null,
  reason text not null,
  disease text,
  headline text,
  publication_date text,
  payload_r2_key text,
  created_at text not null
);

create table if not exists digest_runs (
  id text primary key,
  period text not null,
  r2_html_key text,
  findings_count integer not null default 0 check (findings_count >= 0),
  created_at text not null,
  sent_at text,
  metadata_json text
);

create index if not exists idx_sources_enabled_type on sources(enabled, type);
create index if not exists idx_sources_legacy_watch_uuid on sources(legacy_watch_uuid);
create index if not exists idx_source_state_next_check on source_state(next_check_at);
create index if not exists idx_source_snapshots_source_time on source_snapshots(source_id, fetched_at desc);
create index if not exists idx_scan_events_status_next on scan_events(status, next_attempt_at);
create index if not exists idx_scan_events_source_status on scan_events(source_id, status);
create index if not exists idx_scan_runs_source_time on scan_runs(source_id, started_at desc);
create index if not exists idx_scan_runs_status_time on scan_runs(status, started_at desc);
create index if not exists idx_findings_publication_date on findings(publication_date desc);
create index if not exists idx_findings_risk_date on findings(risk, publication_date desc);
create index if not exists idx_findings_disease_date on findings(disease, publication_date desc);
create index if not exists idx_findings_source_date on findings(source_id, publication_date desc);
create index if not exists idx_findings_approved_date on findings(approved, publication_date desc);
create index if not exists idx_findings_created_at on findings(created_at desc);
create index if not exists idx_quarantine_source_time on quarantine_findings(source_id, created_at desc);
create index if not exists idx_digest_runs_period_time on digest_runs(period, created_at desc);
