import { createHash } from "node:crypto";

export type MigrationEntry = { version: string; file: string; sha256: string };
export type MigrationRegistry = { schemaVersion: 1; migrations: MigrationEntry[] };

export function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validateMigrationSet(
  registry: MigrationRegistry,
  files: ReadonlyMap<string, Uint8Array>,
  previous?: MigrationRegistry
): void {
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.migrations)) {
    throw new Error("Unsupported migration registry");
  }
  const seen = new Set<string>();
  let last = "";
  for (const entry of registry.migrations) {
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(entry.file) || entry.version !== entry.file.slice(0, 14)) {
      throw new Error("Invalid migration filename/version");
    }
    if (entry.version <= last || seen.has(entry.file)) throw new Error("Migrations must have unique increasing versions");
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("Invalid migration checksum");
    const bytes = files.get(entry.file);
    if (!bytes || sha256(bytes) !== entry.sha256) throw new Error(`Migration checksum mismatch: ${entry.file}`);
    seen.add(entry.file);
    last = entry.version;
  }
  if (files.size !== seen.size) throw new Error("Unregistered migration file");
  if (previous) {
    if (previous.schemaVersion !== 1 || !Array.isArray(previous.migrations)) throw new Error("Unsupported previous registry");
    for (const [index, old] of previous.migrations.entries()) {
      const current = registry.migrations[index];
      if (!current || current.file !== old.file || current.version !== old.version || current.sha256 !== old.sha256) {
        throw new Error("Applied migration history is immutable; append a corrective migration");
      }
    }
  }
}
