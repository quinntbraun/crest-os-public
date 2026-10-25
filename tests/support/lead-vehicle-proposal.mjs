// Disposable-only forward39; never mutates the canonical registry or SQL.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export async function leadVehicleProposal(sandbox){
 const path=await sandbox.prefix(38),file='20261025140000_lead_vehicles.sql';
 const sql=await readFile(new URL('../../planning/sql/lead-vehicle-proposal.sql',import.meta.url));
 const registry=JSON.parse(await readFile(join(path,'supabase/migration-checksums.json'),'utf8'));
 if(registry.migrations.length!==38)throw new Error('LEAD_VEHICLE_PROPOSAL_BASE_REQUIRED');
 registry.migrations.push({version:'20261025140000',file,sha256:createHash('sha256').update(sql).digest('hex')});
 await writeFile(join(path,'supabase/migrations',file),sql);
 await writeFile(join(path,'supabase/migration-checksums.json'),JSON.stringify(registry)+'\n');
 return path;
}
