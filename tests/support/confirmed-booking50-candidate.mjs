// Disposable packaging only: does not register50 or alter an owner installation.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
export const booking50Bodies=Object.freeze(['fulfillment-mode-storage','fulfillment-mode-commands','confirmed-bookings-storage','confirmed-bookings-history','confirmed-bookings-invariants','confirmed-bookings-job-invariants','confirmed-bookings-commands','confirmed-bookings-reads','confirmed-bookings-enable','confirmed-bookings-cancel','confirmed-bookings-reschedule','confirmed-bookings-reschedule-commands','confirmed-bookings-history-reads','confirmed-bookings-source','confirmed-bookings-resolution','confirmed-bookings-original','confirmed-bookings-context']);
const hash=v=>createHash('sha256').update(v).digest('hex');
export async function confirmedBooking50Candidate(sandbox){
 const frozen=await readFile(join(sandbox.root,'tests/support/registered49-migration-checksums.json')),registry=JSON.parse(frozen),directory=await sandbox.prefix(49),prefix=JSON.parse(await readFile(join(directory,'supabase/migration-checksums.json'),'utf8'));assert.equal(registry.migrations.length,49);assert.deepEqual(prefix,registry);
 let sql=`-- Confirmed booking schema50 candidate. Synthetic construction only.
-- Reviewed SQL bytes are unchanged. The coordinator owns one atomic transaction.
-- Runtime/production/real-data/financial activation and full V1 release remain gated.
DO $candidate_review$ BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_session_owner','crest_command_owner','crest_quote_owner','crest_export_owner','crest_export','crest_web') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>7 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING50_SOURCE_REVIEW_REQUIRED';END IF;
END $candidate_review$;
`,bodies=[];
 for(const name of booking50Bodies){const path='planning/proposals/'+name+'.sql',bytes=await readFile(join(sandbox.root,path));sql+='\nRESET ROLE;\n-- BEGIN REVIEWED '+name+'.sql\n';const offset=Buffer.byteLength(sql);sql+=bytes.toString('utf8');assert(Buffer.from(sql).subarray(offset).equals(bytes));bodies.push({path,offset,bytes:bytes.length,sha256:hash(bytes)});sql+='\nRESET ROLE;\n-- END REVIEWED '+name+'.sql\n';}
 const file='20261030160000_confirmed_bookings.sql',bytes=Buffer.from(sql),entry={version:'20261030160000',file,sha256:hash(bytes)};registry.migrations.push(entry);const registryBytes=Buffer.from(JSON.stringify(registry,null,2)+'\n');await writeFile(join(directory,'supabase/migrations',file),bytes);await writeFile(join(directory,'supabase/migration-checksums.json'),registryBytes);
 return Object.freeze({directory,file,sql,sha256:entry.sha256,bytes:bytes.length,registrySha256:hash(registryBytes),previousRegistrySha256:hash(frozen),bodies:Object.freeze(bodies)});
}
