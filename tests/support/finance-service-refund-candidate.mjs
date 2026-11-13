import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {financePairedInvoiceCredit85Candidate} from './finance-paired-invoice-credit85-candidate.mjs';
import {serviceRefundSourceAddedColumns,serviceRefundSourceCoverage} from '../../src/bookkeeping/service-refund-source.ts';

const hash=value=>createHash('sha256').update(value).digest('hex');
export const serviceRefundVersion='20261210180000';
export const serviceRefundFile=serviceRefundVersion+'_fictional_service_refund.sql';
export const serviceRefundPriorRegistrySha256='8e96eb7d73afaf5d866ff87dbed10ece5bddb0c5d7c3aa024f321e15f832fff0';
export const serviceRefundParts=Object.freeze(['finance-service-refund','finance-service-refund-operations','finance-service-refund-source']
 .map(name=>'planning/proposals/'+name+'.sql'));

export function serviceRefundCoverage(baseline){
 const tables=baseline.tables.map(row=>{
  const added=serviceRefundSourceAddedColumns[row.table];
  return added?{...row,required:[...row.required,...added]}:row;
 });
 return {...baseline,migrationCount:86,tables:[...tables,serviceRefundSourceCoverage]};
}

export async function financeServiceRefundCandidate(sandbox,previous){
 previous??=await financePairedInvoiceCredit85Candidate(sandbox);
 const {directory,coverage:baseline}=previous;
 const registryPath=join(directory,'supabase/migration-checksums.json');
 const priorRegistry=await readFile(registryPath);
 assert.equal(hash(priorRegistry),serviceRefundPriorRegistrySha256);
 const registry=JSON.parse(priorRegistry);
 assert.equal(registry.migrations.length,85);
 const parts=[];
 let source='-- Held P08 service refund. The migration coordinator owns the transaction.\n';
 for(const path of serviceRefundParts){
  const body=await readFile(join(sandbox.root,path));
  source+='\nRESET ROLE;\n-- BEGIN REVIEWED '+path+'\n';
  const offset=Buffer.byteLength(source);
  source+=body.toString('utf8');
  assert(Buffer.from(source).subarray(offset).equals(body));
  parts.push({path,offset,bytes:body.length,sha256:hash(body)});
  source+='\nRESET ROLE;\n-- END REVIEWED '+path+'\n';
 }
 const sha256=hash(source);
 registry.migrations.push({version:serviceRefundVersion,file:serviceRefundFile,sha256});
 await writeFile(join(directory,'supabase/migrations',serviceRefundFile),source,{flag:'wx'});
 const registryBytes=JSON.stringify(registry,null,2)+'\n';
 await writeFile(registryPath,registryBytes);
 return {directory,file:serviceRefundFile,sha256,bytes:Buffer.byteLength(source),parts,
  registrySha256:hash(registryBytes),priorRegistry,baseline,coverage:serviceRefundCoverage(baseline)};
}
