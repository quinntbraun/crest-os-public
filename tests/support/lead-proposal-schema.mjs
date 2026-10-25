// Temporary isolated schema37 proposal. Never modifies canonical source bytes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,cp} from 'node:fs/promises';
import {join} from 'node:path';
const version='20261025100000',file=version+'_lead_intake.sql';
export async function leadProposalRegistry(){
 const raw=await readFile(new URL('../../supabase/migration-checksums.json',import.meta.url)),base=JSON.parse(raw),sql=await readFile(new URL('./proposed-lead-intake.sql',import.meta.url));
 assert.equal(base.migrations.length,36,'proposal requires the unchanged canonical36 prefix');
 const registry={...base,migrations:[...base.migrations,{version,file,sha256:createHash('sha256').update(sql).digest('hex')}]};
 return {registry,registryBytes:Buffer.from(JSON.stringify(registry)+'\n'),sql};
}
export async function createLeadProposal(sandbox){
 const prefix=await sandbox.prefix(36),proposal=join(sandbox.workspace,'lead-proposal37');
 await cp(prefix,proposal,{recursive:true,errorOnExist:true,force:false});
 const {registryBytes,sql}=await leadProposalRegistry();
 await writeFile(join(proposal,'supabase/migrations',file),sql);
 await writeFile(join(proposal,'supabase/migration-checksums.json'),registryBytes);
 assert.equal(JSON.parse(await readFile(join(prefix,'supabase/migration-checksums.json'),'utf8')).migrations.length,36,'proposal must not mutate the historical prefix');
 return proposal;
}
