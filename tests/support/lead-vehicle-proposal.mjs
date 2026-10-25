// Disposable-only forward39; never mutates the canonical registry or SQL.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {leadVehicleColumns} from '../../src/customer/lead-vehicle-contract.ts';
export async function leadVehicleProposalCoverage(){
 const manifest=JSON.parse(await readFile(new URL('../../planning/SECURITY_EXPORT_COVERAGE.json',import.meta.url),'utf8'));
 if(manifest.migrationCount!==38||manifest.tables.length!==29)throw new Error('LEAD_VEHICLE_PROPOSAL_BASE_REQUIRED');
 manifest.migrationCount=39;manifest.tables.push({table:'crest.lead_vehicles',scope:'business',required:[...leadVehicleColumns],excluded:[],partialEvidenceGroup:null});return manifest;
}
export async function leadVehicleProposalRegistry(){
 const file='20261025140000_lead_vehicles.sql';
 const sql=await readFile(new URL('../../planning/sql/lead-vehicle-proposal.sql',import.meta.url));
 const registry=JSON.parse(await readFile(new URL('../../supabase/migration-checksums.json',import.meta.url),'utf8'));
 if(registry.migrations.length!==38)throw new Error('LEAD_VEHICLE_PROPOSAL_BASE_REQUIRED');
 registry.migrations.push({version:'20261025140000',file,sha256:createHash('sha256').update(sql).digest('hex')});
 return {file,sql,registry,bytes:Buffer.from(JSON.stringify(registry)+'\n')};
}
export async function leadVehicleProposal(sandbox){
 const path=await sandbox.prefix(38),{file,sql,bytes}=await leadVehicleProposalRegistry();
 await writeFile(join(path,'supabase/migrations',file),sql);
 await writeFile(join(path,'supabase/migration-checksums.json'),bytes);
 return path;
}
