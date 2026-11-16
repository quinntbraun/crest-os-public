import 'server-only';
import pg from 'pg';
import type { SessionDatabaseConfiguration } from '../security/session-database.ts';

export const googleCalendarConsentStatements = Object.freeze({
  prepare: 'SELECT crest_commands.prepare_google_calendar_initial_consent($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::boolean,$14::boolean,$15::boolean) AS result',
  confirm: 'SELECT crest_commands.confirm_google_calendar_initial_consent($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::boolean,$14::boolean,$15::boolean,$16::boolean,$17::boolean,$18::boolean) AS result',
  lookup: 'SELECT crest_commands.lookup_google_calendar_initial_consent($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::uuid,$12::uuid) AS result',
});

export const googleCalendarSetupStatements = Object.freeze({
  state: 'SELECT crest_commands.read_google_calendar_setup_state($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',
  jobStatus: 'SELECT crest_commands.read_google_calendar_job_status($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid) AS result',
  begin: 'SELECT crest_commands.begin_google_calendar_oauth_attempt($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::bigint,$11::text,$12::text,$13::text,$14::uuid,$15::bytea,$16::text,$17::jsonb) AS result',
  consume: 'SELECT crest_commands.consume_google_calendar_oauth_attempt($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::bigint,$11::text,$12::text,$13::text,$14::uuid,$15::bytea) AS result',
  exchange: 'SELECT crest_commands.admit_google_calendar_creation_exchange($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::text,$11::text,$12::text,$13::uuid) AS result',
  confirm: 'SELECT crest_commands.confirm_google_calendar_creation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::text,$11::text,$12::text,$13::uuid,$14::text,$15::boolean) AS result',
  admit: 'SELECT crest_commands.admit_google_calendar_secondary_creation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::text,$11::text,$12::text,$13::uuid) AS result',
  finish: 'SELECT crest_commands.finish_google_calendar_secondary_creation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::text,$11::text,$12::text,$13::uuid,$14::text,$15::text,$16::text,$17::uuid) AS result',
  promote: 'SELECT crest_commands.promote_google_calendar_initial_destination($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::text,$11::text,$12::text,$13::uuid,$14::uuid,$15::uuid,$16::text,$17::jsonb) AS result',
});

const consentParameters = new Map<string, number>([[googleCalendarConsentStatements.prepare, 15],
  [googleCalendarConsentStatements.confirm, 18], [googleCalendarConsentStatements.lookup, 12]]);
const setupParameters = new Map<string, number>([...consentParameters, [googleCalendarSetupStatements.state, 9], [googleCalendarSetupStatements.jobStatus, 10],
  [googleCalendarSetupStatements.begin, 17], [googleCalendarSetupStatements.consume, 15], [googleCalendarSetupStatements.exchange, 13],
  [googleCalendarSetupStatements.confirm, 15], [googleCalendarSetupStatements.admit, 13], [googleCalendarSetupStatements.finish, 17],
  [googleCalendarSetupStatements.promote, 17]]);

export const googleCalendarWorkerStatements = Object.freeze({
  next: 'SELECT crest_commands.next_fictional_google_calendar_job($1::uuid) AS result',
  claim: 'SELECT crest_commands.claim_google_calendar_dispatch($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::uuid) AS result',
  material: 'SELECT crest_commands.read_google_calendar_worker_material($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::uuid,$6::uuid) AS result',
  record: 'SELECT crest_commands.record_google_calendar_send($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::uuid,$6::uuid,$7::text,$8::text,$9::text) AS result',
  admit: 'SELECT crest_commands.admit_google_calendar_request($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::uuid,$6::uuid,$7::text) AS result',
  finish: 'SELECT crest_commands.finish_google_calendar_dispatch($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::uuid,$6::uuid,$7::text,$8::text) AS result',
});
const workerParameters = new Map<string, number>([[googleCalendarWorkerStatements.next, 1], [googleCalendarWorkerStatements.claim, 5], [googleCalendarWorkerStatements.material, 6],
  [googleCalendarWorkerStatements.record, 9], [googleCalendarWorkerStatements.admit, 7], [googleCalendarWorkerStatements.finish, 8]]);

const roleGuard = `SELECT current_user=$1::name AND EXISTS (
  SELECT 1 FROM pg_catalog.pg_roles login
  CROSS JOIN pg_catalog.pg_roles executor
  WHERE login.rolname=session_user AND executor.rolname=$1::name
    AND login.rolcanlogin AND NOT (login.rolsuper OR login.rolbypassrls OR login.rolcreatedb OR login.rolcreaterole OR login.rolreplication OR login.rolinherit)
    AND NOT (executor.rolcanlogin OR executor.rolsuper OR executor.rolbypassrls OR executor.rolcreatedb OR executor.rolcreaterole OR executor.rolreplication OR executor.rolinherit)
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=login.oid AND m.roleid=executor.oid AND m.set_option)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=executor.oid OR
      (m.member=login.oid AND (m.roleid<>executor.oid OR m.admin_option OR m.inherit_option)))
) AS allowed`;

function connectionUrl(config: SessionDatabaseConfiguration) {
  try {
    const url = new URL(config.connectionString);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.password ||
      !url.pathname.slice(1) || url.search || url.hash || !['production', 'test'].includes(config.environment) ||
      (config.environment === 'test' && (!['127.0.0.1', '[::1]'].includes(url.hostname) ||
        !/^\/crest_migrate_[a-f0-9]{16}$/.test(url.pathname)))) throw new Error();
    return url.toString();
  } catch {
    throw new Error('GOOGLE_CALENDAR_DATABASE_CONFIGURATION_REQUIRED');
  }
}

// The initial consent HTTP handlers need only these three committed commands.
// There is no arbitrary query, provider traffic, or shared web role fallback.
export function googleCalendarConsentDatabase(config: SessionDatabaseConfiguration) {
  return googleCalendarDatabase(config, 'crest_calendar_oauth', consentParameters);
}

export function syntheticGoogleCalendarSetupDatabase(config: SessionDatabaseConfiguration) {
  if (config.environment !== 'test') throw Error('GOOGLE_CALENDAR_DATABASE_CONFIGURATION_REQUIRED');
  return googleCalendarDatabase(config, 'crest_calendar_oauth', setupParameters);
}

export function syntheticGoogleCalendarWorkerDatabase(config: SessionDatabaseConfiguration) {
  if (config.environment !== 'test') throw Error('GOOGLE_CALENDAR_DATABASE_CONFIGURATION_REQUIRED');
  return googleCalendarDatabase(config, 'crest_calendar_dispatch', workerParameters);
}

function googleCalendarDatabase(config: SessionDatabaseConfiguration, role: 'crest_calendar_oauth' | 'crest_calendar_dispatch',
  parameters: ReadonlyMap<string, number>) {
  const connectionString = connectionUrl(config);
  const ssl = config.environment === 'production' ? { rejectUnauthorized: true } : false;
  return async (statement: string, values: unknown[], signal: AbortSignal): Promise<unknown> => {
    if (signal.aborted || !Array.isArray(values) || parameters.get(statement) !== values.length)
      throw new Error('GOOGLE_CALENDAR_DATABASE_FAILED');

    const client = new pg.Client({ connectionString, ssl, connectionTimeoutMillis: 1000, statement_timeout: 10000,
      lock_timeout: 3000, query_timeout: 11000, options: '-c role=' + role, application_name: role });
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    const timer = setTimeout(() => controller.abort(), 15000);
    timer.unref();
    let closing: Promise<void> | undefined;
    const close = () => closing ??= client.end().catch(() => undefined);
    const abort = () => { void close(); };
    const failed = () => new Error('GOOGLE_CALENDAR_DATABASE_FAILED');
    client.on('error', () => controller.abort());
    combined.addEventListener('abort', abort, { once: true });
    const interrupted = new Promise<never>((_, reject) => {
      combined.addEventListener('abort', () => reject(failed()), { once: true });
    });

    try {
      const transaction = async () => {
        await client.connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL idle_in_transaction_session_timeout='12s'; SET LOCAL transaction_timeout='15s'");
        const guard = await client.query<{ allowed: boolean }>(roleGuard, [role]);
        if (guard.rows.length !== 1 || guard.rows[0]?.allowed !== true || combined.aborted) throw failed();
        const result = await client.query<{ result: unknown }>(statement, values);
        if (result.rows.length !== 1 || !Object.hasOwn(result.rows[0] ?? {}, 'result') || combined.aborted) throw failed();
        const completion = await client.query('COMMIT');
        if (completion.command !== 'COMMIT' || combined.aborted) throw failed();
        return result.rows[0]!.result;
      };
      const result = await Promise.race([transaction(), interrupted]);
      await close();
      if (combined.aborted) throw failed();
      return result;
    } catch {
      throw failed();
    } finally {
      clearTimeout(timer);
      combined.removeEventListener('abort', abort);
      // PostgreSQL rolls back any open transaction when the connection closes.
      await close();
    }
  };
}
