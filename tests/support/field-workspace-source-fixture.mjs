// Fixed restricted readers on one caller-owned synthetic export connection.
// No test hooks, mutation, owner identity shortcut or production activation.
import assert from 'node:assert/strict';
import {collectAcceptedAmendmentSources} from './accepted-amendment-source-fixture.mjs';
import {bookingFoundationEvidence} from './booking-source-evidence.mjs';
import {collectFieldSourcesInSnapshot} from '../../src/operations/field-source-collector.ts';
const value=async(c,q,a=[])=>(await c.query(q,a)).rows[0].value;
export async function captureFieldWorkspaceFixture(c,business){
 await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
  const commercial=await collectAcceptedAmendmentSources(c,business),field=(await collectFieldSourcesInSnapshot(c,business,new AbortController().signal)).forServer(),foundation=await bookingFoundationEvidence(c,business),crm={};
  assert.deepEqual(JSON.parse(commercial.historyEvidence).records,JSON.parse(foundation.history).records);assert.deepEqual(JSON.parse(field.historyEvidence).records,JSON.parse(foundation.history).records);
  for(const [name,routine,key]of [['customers','customer','customers'],['addresses','address','addresses'],['vehicles','vehicle','vehicles'],['associations','association','associations']]){
   const context=await value(c,'SELECT crest_commands.'+routine+'_snapshot_context($1) value',[business]),rows=[];let after=null,done=false;
   for(let pageNo=0;pageNo<10001;pageNo++){
    const page=await value(c,'SELECT crest_commands.'+routine+'_snapshot_page($1,$2,$3,20) value',[business,context.snapshotToken,after]);assert.equal(page.businessId,business);assert.equal(page.snapshotToken,context.snapshotToken);
    for(const row of page[key]){assert.equal(row.business_id,business);assert(after===null||row.id>after);rows.push(row);after=row.id;}if(page[key].length<20){done=true;break;}
   }
   assert(done);assert.equal(String(rows.length),context.rowCount);crm[name]={businessId:business,snapshotToken:context.snapshotToken,expectedRowCount:context.rowCount,rows};
  }
  const result={...foundation,commercial:{...commercial,historyEvidence:foundation.history},field:{...field,historyEvidence:foundation.history},crm};await c.query('COMMIT');return result;
 }catch(e){await c.query('ROLLBACK');throw e;}
}
// Only capture metadata differs across physical databases. Every source row,
// canonical evidence string, amount, historical timestamp and receipt remains.
export function fieldWorkspaceContent(source){
 const copy=structuredClone(source);
 for(const name of ['configuration','identity','history']){const collection=JSON.parse(copy[name]);delete collection.generationId;delete collection.context.snapshotToken;delete collection.context.observedAt;copy[name]=JSON.stringify(collection);}
 copy.commercial.historyEvidence=copy.history;copy.field.historyEvidence=copy.history;
 for(const row of [copy.commercial,copy.commercial.quotes,copy.commercial.bookings])for(const key of ['snapshotToken','commercialSnapshotToken','historySnapshotToken','quoteReviewSnapshotToken'])delete row[key];
 for(const key of ['snapshotToken','historySnapshotToken','observedAt'])delete copy.field.context[key];
 for(const snapshot of Object.values(copy.crm))delete snapshot.snapshotToken;
 return copy;
}
