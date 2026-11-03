// Disposable coordinator packaging only; no repository registration/owner upgrade.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const sha=v=>createHash('sha256').update(v).digest('hex');
export async function bookingConflict51Candidate(sandbox){
 const frozen=await readFile(join(sandbox.root,'tests/support/registered50-migration-checksums.json')),registry=JSON.parse(frozen),directory=await sandbox.prefix(50),prefix=JSON.parse(await readFile(join(directory,'supabase/migration-checksums.json'),'utf8'));
 assert.equal(registry.migrations.length,50);assert.deepEqual(prefix,registry);
 const path='planning/proposals/booking-conflict-review.sql',body=await readFile(join(sandbox.root,path));
 let sql=`-- Booking conflict review schema51 candidate. Synthetic construction only.
-- The migration coordinator owns the atomic transaction. No historical row rewrite.
DO $candidate_review$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>50 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING51_PREFIX_REQUIRED';END IF;
END $candidate_review$;
RESET ROLE;
-- BEGIN REVIEWED booking-conflict-review.sql
`;
 const offset=Buffer.byteLength(sql);sql+=body.toString('utf8');assert(Buffer.from(sql).subarray(offset).equals(body));sql+='\nRESET ROLE;\n-- END REVIEWED booking-conflict-review.sql\n';
 const historyPath='planning/proposals/booking-conflict-history.sql',history=await readFile(join(sandbox.root,historyPath));sql+='\nRESET ROLE;\n-- BEGIN REVIEWED booking-conflict-history.sql\n';const historyOffset=Buffer.byteLength(sql);sql+=history.toString('utf8');assert(Buffer.from(sql).subarray(historyOffset).equals(history));sql+='\nRESET ROLE;\n-- END REVIEWED booking-conflict-history.sql\n';
 const bytes=Buffer.from(sql),file='20261102180000_booking_conflict_review.sql',entry={version:'20261102180000',file,sha256:sha(bytes)};registry.migrations.push(entry);const registryBytes=Buffer.from(JSON.stringify(registry,null,2)+'\n');
 await writeFile(join(directory,'supabase/migrations',file),bytes);await writeFile(join(directory,'supabase/migration-checksums.json'),registryBytes);
 return Object.freeze({directory,file,sql,sha256:entry.sha256,bytes:bytes.length,registrySha256:sha(registryBytes),previousRegistrySha256:sha(frozen),body:Object.freeze({path,offset,bytes:body.length,sha256:sha(body)}),historyBody:Object.freeze({path:historyPath,offset:historyOffset,bytes:history.length,sha256:sha(history)})});
}
