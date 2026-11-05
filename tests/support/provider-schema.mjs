import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

// The official, digest-pinned Auth binary applies its embedded migrations.
// This is isolated provider DDL, not a hosted account or an HTTP Auth service.
export async function installProviderSchema(client,target) {
  const url=new URL(target);
  assert.equal(process.env.CREST_ENV,'test');
  assert(['127.0.0.1','[::1]'].includes(url.hostname));
  assert.match(url.pathname,/^\/crest_migrate_[a-f0-9]{16}$/);assert(!url.search&&!url.hash);
  const {testAuthImage}=JSON.parse(await readFile(new URL('../../release/toolchain.json',import.meta.url),'utf8'));
  assert.match(testAuthImage,/^supabase\/gotrue:v2\.197\.0@sha256:[a-f0-9]{64}$/);
  await client.query('CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin');
  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  // SET ROLE does not apply login-role defaults. Match the provider's normal
  // auth-first search path so its unqualified migration ledger stays in auth.
  if(process.platform==='win32')url.hostname='host.docker.internal';
  url.searchParams.set('options','-c role=supabase_auth_admin -c search_path=auth,public');
  const env={...process.env,GOTRUE_DB_DATABASE_URL:url.toString(),GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_NAMESPACE:'auth',
    GOTRUE_SITE_URL:'http://127.0.0.1:3000',API_EXTERNAL_URL:'http://127.0.0.1:9999',
    GOTRUE_JWT_SECRET:randomBytes(48).toString('base64url'),GOTRUE_LOG_LEVEL:'error'};
  const names=['GOTRUE_DB_DATABASE_URL','GOTRUE_DB_DRIVER','GOTRUE_DB_NAMESPACE','GOTRUE_SITE_URL','API_EXTERNAL_URL','GOTRUE_JWT_SECRET','GOTRUE_LOG_LEVEL'];
  try {
    execFileSync('docker',['run','--rm',...(process.platform==='win32'?[]:['--network','host']),...names.flatMap(name=>['--env',name]),testAuthImage,'auth','migrate'],
      {env,stdio:['ignore','pipe','pipe'],timeout:120000,maxBuffer:2*1024*1024});
  } catch (error) {
    // Classify known setup errors only; never echo provider output/configuration.
    const text=String(error.stderr??'');
    const kind=['permission denied','must be owner','does not exist','connection refused','invalid','not found'].find(s=>text.includes(s))??'unclassified';
    // eslint-disable-next-line preserve-caught-error -- Provider causes may contain credentials; expose only the safe setup category.
    throw new Error(`SYNTHETIC_PROVIDER_MIGRATION_FAILED:${kind}`);
  }
  assert.equal((await client.query('SELECT max(version) AS version FROM auth.schema_migrations')).rows[0].version,'20260831180000');
}
