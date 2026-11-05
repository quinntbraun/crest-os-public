// Disposable candidate packaging. This does not register49 or change the app.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const files=['owner-expenses.sql','owner-expense-receipts.sql','owner-expenses-activity.sql','owner-expenses-original.sql','owner-expense-receipts-original.sql','owner-expenses-resolution.sql','owner-expenses-source.sql'];
const hash=v=>createHash('sha256').update(v).digest('hex');
export async function ownerExpense49Candidate(sandbox){
 const frozen=await readFile(join(sandbox.root,'tests/support/registered48-migration-checksums.json')),registry=JSON.parse(frozen),directory=await sandbox.prefix(48),prefix=JSON.parse(await readFile(join(directory,'supabase/migration-checksums.json'),'utf8'));assert.equal(registry.migrations.length,48);assert.deepEqual(prefix,registry);
 let sql=`-- Owner expense and private receipt schema49. Runtime and production activation remain gated.
-- Exact proposed bodies are preserved; historical source comments do not amend full V1 or double-entry requirements.
-- The migration coordinator owns one atomic transaction. No real-data/financial activation.
DO $candidate_review$ BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_session_owner','crest_command_owner','crest_quote_owner','crest_export_owner','crest_export','crest_web') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>7 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPENSE49_SOURCE_REVIEW_REQUIRED';END IF;
END $candidate_review$;
`,bodies=[];
 for(const file of files){const bytes=await readFile(join(sandbox.root,'planning/proposals',file));sql+='\nRESET ROLE;\n-- BEGIN REVIEWED '+file+'\n';const offset=Buffer.byteLength(sql);sql+=bytes.toString('utf8');assert(Buffer.from(sql).subarray(offset).equals(bytes));bodies.push({path:'planning/proposals/'+file,offset,bytes:bytes.length,sha256:hash(bytes)});sql+='\nRESET ROLE;\n-- END REVIEWED '+file+'\n';}
 const file='20261029050000_owner_expenses.sql',bytes=Buffer.from(sql),entry={version:'20261029050000',file,sha256:hash(bytes)};registry.migrations.push(entry);const registryBytes=Buffer.from(JSON.stringify(registry,null,2)+'\n');await writeFile(join(directory,'supabase/migrations',file),bytes);await writeFile(join(directory,'supabase/migration-checksums.json'),registryBytes);
 return Object.freeze({directory,file,sql,sha256:entry.sha256,bytes:bytes.length,registrySha256:hash(registryBytes),previousRegistrySha256:hash(frozen),bodies:Object.freeze(bodies)});
}
