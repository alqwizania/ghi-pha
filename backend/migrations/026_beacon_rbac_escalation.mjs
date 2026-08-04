/**
 * Migration 026 — revive Beacon, close a stale escalation, add departments.
 *
 * BEACON. Disabled since the source repairs because its event list is built
 * client-side and the Jina proxy returned only a page shell — the same class of
 * failure as the six JavaScript sources. The crawler box resolves it: rendering
 * beaconbio.org returns real dated events. It is re-enabled with a browser
 * strategy and a 15-second settle, because the list arrives well after first
 * paint. Historically Beacon supplied 148 of 150 triage signals, so this is the
 * single highest-value source in the registry.
 *
 * ESCALATION. One record still reads "Strategic threshold met" — the fixed
 * string every escalation carried before reasons were derived. Its signal and
 * assessment were both archived by migration 017, which did not reach the
 * escalations table, so the dashboard reports an active escalation for an event
 * that no longer exists. Resolved rather than deleted: a director's decision
 * stays on the record, it simply stops being outstanding.
 *
 * DEPARTMENTS. Users gain a department, since PHA staff belong to either Global
 * Health or Public Health Intelligence and an audit trail that cannot say which
 * team took a decision is weaker than one that can.
 *
 * PERMISSIONS. The stored permission objects disagree with each other and with
 * the views that exist — some users carry 'escalation', which is not a view;
 * none carry 'radar', which is. They are normalised onto the real view set so
 * that server-side enforcement has something coherent to enforce.
 *
 * Usage:  node migrations/026_beacon_rbac_escalation.mjs [--apply]
 */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APPLY = process.argv.includes('--apply');
const VIEWS = ['dashboard', 'radar', 'listener', 'triage', 'assessment'];

// Role -> the access each view carries. Superadmin and Admin administer people;
// Director reviews escalations; Analyst works the queue.
const ROLE_DEFAULTS = {
  Superadmin: { dashboard: 'edit', radar: 'edit', listener: 'edit', triage: 'edit', assessment: 'edit' },
  Admin:      { dashboard: 'edit', radar: 'edit', listener: 'edit', triage: 'edit', assessment: 'edit' },
  Director:   { dashboard: 'edit', radar: 'view', listener: 'view', triage: 'edit', assessment: 'edit' },
  Analyst:    { dashboard: 'view', radar: 'edit', listener: 'edit', triage: 'edit', assessment: 'edit' },
  Viewer:     { dashboard: 'view', radar: 'view', listener: 'view', triage: 'view', assessment: 'view' },
};

function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const devVars = readFileSync(fileURLToPath(new URL('../.dev.vars', import.meta.url)), 'utf8');
  const m = devVars.match(/^DATABASE_URL=(.*)$/m);
  if (!m) throw new Error('DATABASE_URL not found');
  return m[1].trim().replace(/^"|"$/g, '');
}

const sql = postgres(connectionString(), { ssl: 'require' });

try {
  const users = await sql`SELECT username, role, permissions FROM users ORDER BY username`;
  console.log('users and the permissions they will receive:');
  for (const u of users) {
    const have = Object.keys(u.permissions ?? {}).sort().join(',') || 'none';
    console.log(`  ${u.username.padEnd(12)} ${String(u.role).padEnd(11)} now: ${have}`);
  }
  const stale = await sql`
    SELECT count(*)::int c FROM escalations e JOIN signals s ON s.id = e.signal_id
    WHERE s.current_status = 'Archived' AND e.resolved_at IS NULL`;
  console.log(`\nescalations on archived signals : ${stale[0].c}`);
  console.log(`views enforced                  : ${VIEWS.join(', ')}`);

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply.');
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    await tx`
      UPDATE surveillance_sources
      SET enabled = true, fetch_strategy = 'browser', parser_hint = 'ai',
          disabled_reason = NULL,
          config = coalesce(config,'{}'::jsonb) || ${sql.json({ crawlerWaitMs: 15000, retroWindowDays: 30 })},
          updated_at = now()
      WHERE id = 'BEACON'`;
    await tx`UPDATE source_snapshots SET content_hash = NULL WHERE source_id = 'BEACON'`;
    console.log('enabled : BEACON via the crawler');

    const closed = await tx`
      UPDATE escalations e
      SET director_status = 'Closed',
          director_notes = 'Closed by migration 026: the underlying signal was archived as a pre-repair legacy record.',
          resolved_at = now(), updated_at = now()
      FROM signals s
      WHERE s.id = e.signal_id AND s.current_status = 'Archived' AND e.resolved_at IS NULL
      RETURNING e.id`;
    console.log(`closed  : ${closed.length} escalation(s) on archived signals`);

    await tx`ALTER TABLE users ADD COLUMN IF NOT EXISTS department varchar(60)`;
    await tx`UPDATE users SET department = 'Global Health' WHERE department IS NULL`;
    console.log('added   : users.department (defaulted to Global Health)');

    for (const [role, perms] of Object.entries(ROLE_DEFAULTS)) {
      await tx`UPDATE users SET permissions = ${sql.json(perms)}, updated_at = now() WHERE role = ${role}`;
    }
    console.log('normalised: permissions onto the real view set');
  });

  console.log('\nMigration 026 complete.');
} finally {
  await sql.end();
}
