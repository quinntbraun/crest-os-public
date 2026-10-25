// Disposable-only forward migration proposal; never edits canonical registry.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export async function leadStateProposal(sandbox){
 const path=await sandbox.prefix(37),file='20261025120000_lead_state_events.sql';
 const sql=await readFile(join(sandbox.root,'planning/sql/lead-state-proposal.sql'));
 const registry=JSON.parse(await readFile(join(path,'supabase/migration-checksums.json'),'utf8'));
 registry.migrations.push({version:'20261025120000',file,sha256:createHash('sha256').update(sql).digest('hex')});
 await writeFile(join(path,'supabase/migrations',file),sql);
 await writeFile(join(path,'supabase/migration-checksums.json'),JSON.stringify(registry)+'\n');
 return path;
}
