#!/usr/bin/env node
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const USAGE = `Usage:
  node cloudflare/scripts/backfill-findings-from-nocodb.mjs --database seharadar-prod --remote
  node cloudflare/scripts/backfill-findings-from-nocodb.mjs --print

Options:
  --database <name>      D1 database name accepted by wrangler d1 execute.
  --remote              Execute against remote D1.
  --local               Execute against local D1.
  --page-size <n>       NocoDB page size. Defaults to 1000.
  --max-records <n>     Safety cap. Defaults to 50000.
  --print               Print generated SQL instead of executing wrangler.
  --dry-run             Alias for --print.
  --help                Show this help.
`;

const FINDING_COLUMNS = [
  'disease',
  'source',
  'source_id',
  'source_type',
  'source_link',
  'publication_date',
  'headline',
  'short_description_en',
  'detailed_description_en',
  'short_description_ar',
  'detailed_description_ar',
  'content_hash',
  'risk',
  'risk_assessment',
  'countries_json',
  'regions_json',
  'notification_sent',
  'approved',
  'source_snapshot_id',
  'parser_payload_r2_key',
  'created_at',
  'updated_at',
];

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

if (args.local && args.remote) {
  console.error('Use only one of --local or --remote.');
  process.exit(1);
}

if (!args.print && !args.database) {
  console.error('Missing required --database unless --print is used.');
  console.error(USAGE);
  process.exit(1);
}

const config = loadNocoDbConfig();
const countryConfig = JSON.parse(await readFile(resolve(process.cwd(), 'config/country_centroids.json'), 'utf8'));
const sourceConfig = JSON.parse(await readFile(resolve(process.cwd(), 'config/sources.json'), 'utf8'));
const sourceIds = new Set((sourceConfig.sources || []).map(source => source.id));
const records = await fetchAllNocoDbRecords(config, args);
const rows = records.map(record => mapRecord(record, countryConfig, sourceIds));
const sql = buildSql(rows);

if (args.print) {
  process.stdout.write(sql);
  process.stderr.write(`\nPrepared ${rows.length} D1 finding rows from ${records.length} NocoDB records.\n`);
  process.exit(0);
}

const tempDir = mkdtempSync(join(tmpdir(), 'seharadar-findings-backfill-'));
const sqlPath = join(tempDir, 'backfill-findings.sql');

try {
  writeFileSync(sqlPath, sql, 'utf8');
  const wranglerArgs = ['wrangler', 'd1', 'execute', args.database, '--file', sqlPath];
  if (args.remote) wranglerArgs.push('--remote');
  if (args.local) wranglerArgs.push('--local');

  console.log(`Fetched ${records.length} NocoDB records; importing ${rows.length} rows into D1.`);
  const result = spawnSync('npx', wranglerArgs, {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function parseArgs(argv) {
  const parsed = {
    pageSize: 1000,
    maxRecords: 50000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--print' || arg === '--dry-run') parsed.print = true;
    else if (arg === '--remote') parsed.remote = true;
    else if (arg === '--local') parsed.local = true;
    else if (arg === '--database' || arg === '--page-size' || arg === '--max-records') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--database') parsed.database = value;
      if (arg === '--page-size') parsed.pageSize = positiveInteger(value, 'page-size');
      if (arg === '--max-records') parsed.maxRecords = positiveInteger(value, 'max-records');
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function loadNocoDbConfig() {
  const baseUrl = normalizeBaseUrl(process.env.NOCODB_API_URL || process.env.NC_PUBLIC_URL || '');
  const token = process.env.NOCODB_API_TOKEN || '';
  const tableId = process.env.NOCODB_TABLE_ID || 'm0s3bmpa8qzp4eh';
  const missing = [];
  if (!baseUrl) missing.push('NOCODB_API_URL or NC_PUBLIC_URL');
  if (!token) missing.push('NOCODB_API_TOKEN');
  if (!tableId) missing.push('NOCODB_TABLE_ID');
  if (missing.length) throw new Error(`Missing NocoDB configuration: ${missing.join(', ')}`);
  return { baseUrl, token, tableId };
}

async function fetchAllNocoDbRecords(config, options) {
  const records = [];
  for (let offset = 0; records.length < options.maxRecords; offset += options.pageSize) {
    const limit = Math.min(options.pageSize, options.maxRecords - records.length);
    const url = new URL(`/api/v2/tables/${config.tableId}/records`, config.baseUrl);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('sort', '-publication_date');

    const response = await fetch(url, {
      headers: {
        'xc-token': config.token,
        'content-type': 'application/json',
      },
    });
    if (!response.ok) throw new Error(`NocoDB request failed: HTTP ${response.status}`);
    const payload = await response.json();
    const batch = Array.isArray(payload.list) ? payload.list : [];
    records.push(...batch);
    if (batch.length < limit) break;
  }
  return records;
}

function mapRecord(record, countryConfig, sourceIds) {
  const now = new Date().toISOString();
  const source = text(record.source || record.agency || record.source_id || 'NocoDB');
  const sourceId = sourceIds.has(source) ? source : null;
  const sourceLink = text(record.source_link || record.url);
  const publicationDate = dateText(record.publication_date || record.date || record.created_at || now);
  const headline = text(record.headline || record.title || record.summary || 'Untitled finding');
  const shortDescription = text(record.short_description_en || record.summary || record.description);
  const detailedDescription = text(record.detailed_description_en || record.full_content || record.content || shortDescription);
  const countryCodes = resolveCountryCodes(record, countryConfig);
  const regionCodes = resolveRegionCodes(countryCodes, countryConfig, record);
  const contentHash = text(record.content_hash) || sha256Hex([
    source,
    sourceLink,
    publicationDate,
    headline,
    shortDescription,
  ].join('|'));

  return {
    disease: text(record.disease) || 'Unknown',
    source,
    source_id: sourceId,
    source_type: text(record.source_type) || 'legacy_nocodb',
    source_link: sourceLink,
    publication_date: publicationDate,
    headline,
    short_description_en: shortDescription,
    detailed_description_en: detailedDescription,
    short_description_ar: text(record.short_description_ar),
    detailed_description_ar: text(record.detailed_description_ar),
    content_hash: contentHash,
    risk: normalizeRisk(record.risk || record.priority),
    risk_assessment: text(record.risk_assessment),
    countries_json: JSON.stringify(countryCodes),
    regions_json: JSON.stringify(regionCodes),
    notification_sent: booleanInt(record.notification_sent),
    approved: 1,
    source_snapshot_id: null,
    parser_payload_r2_key: null,
    created_at: dateTimeText(record.created_at || record.CreatedAt || now),
    updated_at: dateTimeText(record.updated_at || record.UpdatedAt || now),
  };
}

function buildSql(rows) {
  const statements = [
    '-- Generated by cloudflare/scripts/backfill-findings-from-nocodb.mjs. Review before manual execution.',
  ];

  for (const row of rows) {
    const values = FINDING_COLUMNS.map(column => sqlValue(row[column])).join(', ');
    const updates = FINDING_COLUMNS
      .filter(column => column !== 'content_hash' && column !== 'created_at')
      .map(column => `${column} = excluded.${column}`)
      .join(', ');
    statements.push(`insert into findings (${FINDING_COLUMNS.join(', ')}) values (${values}) on conflict(content_hash) do update set ${updates};`);
  }

  statements.push('');
  return statements.join('\n');
}

function resolveCountryCodes(record, countryConfig) {
  const codes = [];
  const add = value => {
    const code = resolveCountryCode(value, countryConfig);
    if (code && !codes.includes(code)) codes.push(code);
  };

  for (const value of parseArray(record.countries_json || record.countries)) add(value);
  add(record.country_code);
  add(record.country);
  add(record.country_name);
  add(record.location);

  if (codes.length === 0) {
    const haystack = [record.headline, record.summary, record.short_description_en, record.detailed_description_en, record.full_content]
      .map(value => text(value).toLowerCase())
      .join(' ');
    for (const [alias, code] of Object.entries({ ...(countryConfig.aliases || {}), ...(countryConfig.demonyms || {}) })) {
      if (haystack.includes(alias) && !codes.includes(code)) codes.push(code);
    }
  }

  return codes;
}

function resolveRegionCodes(countryCodes, countryConfig, record) {
  const regions = parseArray(record.regions_json || record.regions).map(value => text(value).toUpperCase()).filter(Boolean);
  for (const code of countryCodes) {
    const region = countryConfig.countries?.[code]?.region;
    if (region && !regions.includes(region)) regions.push(region);
  }
  return regions;
}

function resolveCountryCode(value, countryConfig) {
  const raw = text(value);
  if (!raw) return null;
  const direct = raw.toUpperCase();
  if (countryConfig.countries?.[direct]) return direct;
  const normalized = raw.toLowerCase();
  return countryConfig.aliases?.[normalized] || countryConfig.demonyms?.[normalized] || null;
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }
}

function normalizeBaseUrl(value) {
  return String(value || '').replace('/api/v1', '').replace('/api/v2', '').replace(/\/+$/, '');
}

function normalizeRisk(value) {
  const normalized = text(value).toLowerCase();
  if (['critical', 'very high', 'severe'].includes(normalized)) return 'critical';
  if (normalized === 'high') return 'high';
  if (['medium', 'moderate', 'moderate risk'].includes(normalized)) return 'medium';
  if (['low', 'low risk'].includes(normalized)) return 'low';
  if (['no risk', 'none', 'minimal', 'no_risk', 'no-risk'].includes(normalized)) return 'no_risk';
  if (['unclassified', 'unknown', 'not assessed', 'pending'].includes(normalized)) return 'unclassified';
  return normalized || 'medium';
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function dateText(value) {
  const raw = text(value);
  if (!raw) return new Date().toISOString().slice(0, 10);
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function dateTimeText(value) {
  const raw = text(value);
  if (!raw) return new Date().toISOString();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function booleanInt(value) {
  return value === true || value === 1 || value === 'true' ? 1 : 0;
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sqlValue(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}
