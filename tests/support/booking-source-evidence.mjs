// Reuse existing export-only readers on the caller's held read-only snapshot.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {bookingRecordGroups} from '../../src/operations/confirmed-booking-records.ts';
const value=async(c,q,args)=>(await c.query(q,args)).rows[0].value;
export async function bookingPhysicalEvidence(c,business){
 const scope=await value(c,'SELECT crest_commands.booking_source_snapshot_context($1) AS value',[business]),rows={};
 for(const group of bookingRecordGroups){rows[group]=[];let after=null,done=false;for(let n=0;n<=10000;n++){const page=await value(c,'SELECT crest_commands.booking_source_snapshot_'+group+'($1,$2,$3,20) AS value',[business,scope.snapshotToken,after]);assert.equal(page.businessId,business);assert.equal(page.snapshotToken,scope.snapshotToken);for(const row of page.rows){assert(after===null||row.id>after);rows[group].push(row);after=row.id;}if(!page.hasMore){done=true;break;}}assert(done);assert.equal(String(rows[group].length),scope.expectedCounts[group]);}
 return {businessId:business,snapshotToken:scope.snapshotToken,commercialSnapshotToken:scope.commercialSnapshotToken,historySnapshotToken:scope.historySnapshotToken,expectedCounts:scope.expectedCounts,rows};
}
export async function bookingFoundationEvidence(c,business){
 const generationId=randomUUID(),result={},contexts=(await c.query('SELECT crest_commands.business_configuration_export_context($1) AS configuration,crest_commands.business_identity_export_context($1) AS identity,crest_commands.business_history_export_context($1) AS history',[business])).rows[0];
 for(const [group,prefix,kinds]of [['configuration','business_configuration',['business','membership','recovery_authority']],['identity','business_identity',['actor','role_capability','identity_event']],['history','business_history',['operation','audit_event']]]){
  const context=contexts[group],records=[];
  for(const kind of kinds){let after=null,done=false;for(let n=0;n<100;n++){const page=(await c.query('SELECT * FROM crest_commands.'+prefix+'_export_page($1,$2,$3,$4,20)',[business,context.snapshotToken,kind,after])).rows;if(!page.length){done=true;break;}records.push(...page.map(r=>({kind,recordId:r.record_id,representation:r.representation,canonicalEvidence:r.canonical_evidence,evidenceHash:r.evidence_hash})));after=page.at(-1).record_id;}assert(done);}
  result[group]=JSON.stringify({formatVersion:1,assurance:'snapshot_bytes_only',generationId,context,evidenceBytes:records.reduce((n,r)=>n+Buffer.byteLength(r.canonicalEvidence),0),records});
 }return result;
}
async function oldPage(c,business,contextName,pageName,key,count){
 const scope=await value(c,'SELECT crest_commands.'+contextName+'($1) AS value',[business]),rows=[];let after=null,done=false;
 for(let i=0;i<=10000;i++){const p=await value(c,'SELECT crest_commands.'+pageName+'($1,$2,$3,20) AS value',[business,scope.snapshotToken,after]);assert.equal(p.businessId,business);assert.equal(p.snapshotToken,scope.snapshotToken);for(const row of p[key]){assert(after===null||row.id>after);rows.push(row);after=row.id;}if(p[key].length<20){done=true;break;}}
 assert(done);assert.equal(String(rows.length),scope[count]);return rows;
}
export async function bookingCommercialEvidence(c,business,historyEvidence){
 const scope=await value(c,'SELECT crest_commands.quote_commercial_snapshot_context($1) AS value',[business]),rows={},suffix={commercialState:'commercial_state',sends:'sends',acceptances:'acceptances',agreements:'agreements',entitlements:'entitlements',entitlementVersions:'entitlement_versions',allocations:'allocations'};
 for(const [group,name]of Object.entries(suffix)){rows[group]=[];let after=null,done=false;for(let i=0;i<=10000;i++){const p=await value(c,'SELECT crest_commands.quote_commercial_snapshot_'+name+'($1,$2,$3,20) AS value',[business,scope.snapshotToken,after]);assert.equal(p.businessId,business);assert.equal(p.snapshotToken,scope.snapshotToken);for(const row of p[group]){assert(after===null||row.id>after);rows[group].push(row);after=row.id;}if(!p.hasMore){done=true;break;}}assert(done);assert.equal(String(rows[group].length),scope.expectedCounts[group]);}
 const review=await value(c,'SELECT crest_commands.quote_review_snapshot_context($1) AS value',[business]),quotes={businessId:business,snapshotToken:review.snapshotToken,expectedFamilyCount:review.expectedFamilyCount,expectedRevisionCount:review.expectedRevisionCount,expectedItemCount:review.expectedItemCount,expectedAssessmentCount:review.expectedAssessmentCount,expectedApprovalCount:review.expectedApprovalCount};assert.equal(scope.quoteReviewSnapshotToken,review.snapshotToken);
 for(const group of ['families','revisions','items','assessments','approvals']){quotes[group]=[];let after=null,done=false;for(let i=0;i<=10000;i++){const p=await value(c,'SELECT crest_commands.quote_review_snapshot_'+group+'($1,$2,$3,20) AS value',[business,review.snapshotToken,after]);assert.equal(p.businessId,business);assert.equal(p.snapshotToken,review.snapshotToken);for(const row of p[group]){assert(after===null||row.id>after);quotes[group].push(row);after=row.id;}if(!p.hasMore){done=true;break;}}assert(done);}
 const references={leads:await oldPage(c,business,'lead_snapshot_context','lead_snapshot_page','leads','rowCount'),leadEvents:await oldPage(c,business,'lead_event_snapshot_context','lead_event_snapshot_page','events','rowCount'),conversions:await oldPage(c,business,'lead_conversion_snapshot_context','lead_conversion_snapshot_page','conversions','conversionCount'),conversionLinks:await oldPage(c,business,'lead_conversion_snapshot_context','conversion_link_snapshot_page','links','linkCount')};
 return {businessId:business,snapshotToken:scope.snapshotToken,quoteReviewSnapshotToken:scope.quoteReviewSnapshotToken,expectedCounts:scope.expectedCounts,rows,quotes,references,historyEvidence};
}
