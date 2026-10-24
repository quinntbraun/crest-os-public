// Build/review tooling only. Inventory metadata never authorizes a database
// read, publishes a file, or proves that an export contains source records.
const exclusions = new Set([
  'session_credential', 'browser_credential', 'network_identifier_digest',
  'throttle_key_fingerprint'
]);
const scopes = new Set(['actor', 'business', 'mixed_identity', 'global_configuration', 'runtime_security']);
const groups = new Set([
  'inventory_observation', 'login_attempt', 'login_target', 'login_finish',
  'cleanup_request', 'cleanup_outcome', 'session_identity', 'session_event', 'cleanup_reference'
]);
const identifier = /^[a-z][a-z0-9_]*$/;
const tableName = /^crest(?:_private)?\.[a-z][a-z0-9_]*$/;
const partialGroupsBySource = new Map([
  ['crest_private.provider_inventory_observations', 'inventory_observation'],
  ['crest_private.provider_login_attempts', 'login_attempt'],
  ['crest_private.provider_login_targets', 'login_target'],
  ['crest_private.provider_login_finishes', 'login_finish'],
  ['crest_private.provider_cleanup_requests', 'cleanup_request'],
  ['crest_private.provider_cleanup_outcomes', 'cleanup_outcome'],
  ['crest_private.app_sessions', 'session_identity'],
  ['crest_private.session_events', 'session_event'],
  ['crest_private.provider_cleanup_references', 'cleanup_reference']
]);
// Explicitly reviewed exclusions, never a pattern that can hide future columns.
const excludedColumnsBySource = new Map([
  ['crest_private.app_sessions.token_hash', 'session_credential'],
  ['crest_private.app_sessions.provider_token_ciphertext', 'session_credential'],
  ['crest_private.app_sessions.key_id', 'session_credential'],
  ['crest_private.login_limit_state.key_fingerprint', 'throttle_key_fingerprint'],
  ['crest_private.login_attempts.identifier_hash', 'network_identifier_digest'],
  ['crest_private.login_attempts.ip_hash', 'network_identifier_digest'],
  ['crest_private.login_contexts.credential_hash', 'browser_credential'],
  ['crest_private.login_contexts.ip_hash', 'network_identifier_digest'],
  ['crest_private.login_contexts.csrf_hash', 'browser_credential'],
  ['crest_private.session_csrf_tokens.token_hash', 'browser_credential']
]);
type Row = Record<string, unknown>;
function require(value: unknown): asserts value {
  if (!value) throw new Error('EXPORT_COVERAGE_REVIEW_REQUIRED');
}
function object(value: unknown, fields: string): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === fields.split(',').sort().join(',');
}

// Observations must come from the applied schema's pg_catalog, not this file
// or a SQL-text parser. The caller owns that read-only test/admin connection.
export function verifyExportCoverage(manifest: unknown, observed: unknown, appliedMigrations: number) {
  require(object(manifest, 'formatVersion,migrationCount,tables') && manifest.formatVersion === 1
    && Number.isSafeInteger(appliedMigrations) && appliedMigrations > 0
    && manifest.migrationCount === appliedMigrations && Array.isArray(manifest.tables)
    && manifest.tables.length > 0 && manifest.tables.length <= 1000
    && Array.isArray(observed) && observed.length > 0 && observed.length <= 100000);
  const actual = new Map<string, Set<string>>();
  for (const row of observed) {
    require(object(row, 'table,column') && typeof row.table === 'string' && tableName.test(row.table)
      && typeof row.column === 'string' && identifier.test(row.column));
    let columns = actual.get(row.table);
    if (!columns) { columns = new Set(); actual.set(row.table, columns); }
    require(!columns.has(row.column)); columns.add(row.column);
  }
  let requiredColumns = 0, excludedColumns = 0, partialEvidenceTables = 0;
  const seen = new Set<string>(), seenGroups = new Set<string>();
  for (const entry of manifest.tables) {
    require(object(entry, 'table,scope,required,excluded,partialEvidenceGroup')
      && typeof entry.table === 'string' && tableName.test(entry.table) && !seen.has(entry.table)
      && typeof entry.scope === 'string' && scopes.has(entry.scope)
      && Array.isArray(entry.required) && Array.isArray(entry.excluded)
      && (entry.partialEvidenceGroup === null || typeof entry.partialEvidenceGroup === 'string'
        && groups.has(entry.partialEvidenceGroup) && !seenGroups.has(entry.partialEvidenceGroup)));
    seen.add(entry.table);
    require(entry.partialEvidenceGroup === (partialGroupsBySource.get(entry.table) ?? null));
    if (entry.partialEvidenceGroup !== null) {
      seenGroups.add(entry.partialEvidenceGroup as string); partialEvidenceTables++;
    }
    const columns = new Set<string>();
    function column(value: unknown) {
      require(typeof value === 'string' && identifier.test(value) && !columns.has(value));
      columns.add(value);
    }
    for (const name of entry.required) {
      column(name); require(!excludedColumnsBySource.has(`${entry.table}.${name}`)); requiredColumns++;
    }
    for (const exclusion of entry.excluded) {
      require(object(exclusion, 'column,reason') && typeof exclusion.reason === 'string' && exclusions.has(exclusion.reason));
      column(exclusion.column); excludedColumns++;
      require(excludedColumnsBySource.get(`${entry.table}.${exclusion.column}`) === exclusion.reason);
    }
    const source = actual.get(entry.table);
    require(source && source.size === columns.size && columns.size > 0
      && [...source].every(name => columns.has(name)));
  }
  require(actual.size === seen.size);
  return Object.freeze({
    assurance: 'schema_inventory_only' as const,
    tables: seen.size, requiredColumns, excludedColumns, partialEvidenceTables,
    // Even a matching inventory says nothing about source row completeness,
    // encrypted custody, authorization, backup restore or production readiness.
    completePortableExport: false as const, completeBackup: false as const
  });
}
