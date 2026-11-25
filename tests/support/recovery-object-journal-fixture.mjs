import assert from 'node:assert/strict';
import {open,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRecoveryObjectApplyJournal} from '../../src/tooling/recovery-object-apply-journal.ts';
export async function recoveryObjectJournalFixture(parent,header){
 if(process.platform==='linux')return createRecoveryObjectApplyJournal(parent,header);
 assert.equal(process.env.CREST_ENV,'test');const directory=join(parent,'restore-objects-'+header.operationId);await mkdir(directory,{mode:0o700});let pending,reviewRequired=false,finished=false;
 // Actual private files/file fsync establish dispatch ordering on Windows;
 // this seam explicitly does not certify Linux directory/power-loss durability.
 async function record(name,value){const file=await open(join(directory,name),'wx',0o600);try{await file.writeFile(JSON.stringify(value)+'\n');await file.sync();}finally{await file.close();}}
 await record('started.json',{header,windowsFixtureSeam:true,completeBackup:false});
 return{view:()=>({header,reviewRequired:reviewRequired||!!pending,completeBackup:false}),async reserve(input){assert(!reviewRequired&&!pending&&!finished);pending=Object.freeze({...input,id:randomUUID(),reservedAt:new Date().toISOString()});await record(pending.id+'.reserved.json',pending);return pending;},async acknowledge(input,receipt){assert.equal(input,pending);assert.equal(input.key,receipt.key);assert.equal(input.binding,receipt.binding);assert.equal(input.sha256,receipt.sha256);await record(input.id+'.verified.json',{reservationId:input.id,receipt});pending=undefined;},async uncertain(input){assert.equal(input,pending);reviewRequired=true;await record(input.id+'.uncertain.json',{reservationId:input.id,reviewRequired:true});},async finish(){assert(!pending&&!reviewRequired&&!finished);await record('objects-verified.json',{pointId:header.pointId,completeBackup:false});finished=true;}};
}
