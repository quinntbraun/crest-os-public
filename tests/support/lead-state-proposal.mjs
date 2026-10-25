// Disposable-only forward migration proposal; never edits canonical registry.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export async function leadStateProposalRegistry(){
 const file='20261025120000_lead_state_events.sql',sql=await readFile(new URL('../../planning/sql/lead-state-proposal.sql',import.meta.url));
 const registry=JSON.parse(await readFile(new URL('../../supabase/migration-checksums.json',import.meta.url),'utf8'));
 if(registry.migrations.length!==37)throw new Error('LEAD_STATE_PROPOSAL_BASE_REQUIRED');
 registry.migrations.push({version:'20261025120000',file,sha256:createHash('sha256').update(sql).digest('hex')});
 return {file,sql,registry,bytes:Buffer.from(JSON.stringify(registry)+'\n')};
}
export async function leadStateProposal(sandbox){
 const path=await sandbox.prefix(37),{file,sql,bytes}=await leadStateProposalRegistry();
 await writeFile(join(path,'supabase/migrations',file),sql);
 await writeFile(join(path,'supabase/migration-checksums.json'),bytes);
 return path;
}
