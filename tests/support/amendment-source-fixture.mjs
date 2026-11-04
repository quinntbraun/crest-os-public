// Synthetic export-credential collector. Every page stays on the caller's
// single held RR READ ONLY connection. Not a runtime worker or delivery API.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {quoteAmendmentCommercialTables} from '../../src/commercial/quote-amendment-source-csv.ts';
const value=(c,sql,args=[])=>c.query(sql,args).then(r=>r.rows[0].value);
const suffix={commercialState:'commercial_state',sends:'sends',acceptances:'acceptances',agreements:'agreements',entitlements:'entitlements',entitlementVersions:'entitlement_versions',allocations:'allocations'};
export async function amendmentSourceHistory(c,business){
 const context=await value(c,'SELECT crest_commands.business_history_export_context($1) AS value',[business]),records=[];
 for(const kind of ['operation','audit_event']){let after=null,done=false;for(let n=0;n<10000;n++){const rows=(await c.query('SELECT * FROM crest_commands.business_history_export_page($1,$2,$3,$4,20)',[business,context.snapshotToken,kind,after])).rows;if(!rows.length){done=true;break;}for(const row of rows){assert(after===null||row.record_id>after);records.push({kind,recordId:row.record_id,representation:row.representation,canonicalEvidence:row.canonical_evidence,evidenceHash:row.evidence_hash});after=row.record_id;}}assert(done);}
 return JSON.stringify({formatVersion:1,assurance:'snapshot_bytes_only',generationId:randomUUID(),context,evidenceBytes:records.reduce((n,r)=>n+Buffer.byteLength(r.canonicalEvidence),0),records});
}
async function references(c,business,contextName,pageName,key,count){
 const context=await value(c,'SELECT crest_commands.'+contextName+'($1) AS value',[business]),rows=[];let after=null,done=false;
 for(let n=0;n<10001;n++){const page=await value(c,'SELECT crest_commands.'+pageName+'($1,$2,$3,20) AS value',[business,context.snapshotToken,after]);assert.equal(page.businessId,business);assert.equal(page.snapshotToken,context.snapshotToken);for(const row of page[key]){assert(after===null||row.id>after);rows.push(row);after=row.id;}if(page[key].length<20){done=true;break;}}assert(done);assert.equal(String(rows.length),context[count]);return rows;
}
export async function collectAmendmentSources(c,business,size=2){
 const scope=await value(c,'SELECT crest_commands.quote_amendment_snapshot_context($1) AS value',[business]);assert.equal(scope.schemaVersion,1);assert.equal(scope.scope,'quote_amendment_sources');assert.equal(scope.businessId,business);const rows={};
 async function pageAll(prefix,group,key,token,count,expectedSchema){let after=null,done=false;const output=[];for(let n=0;n<10001;n++){const page=await value(c,'SELECT crest_commands.'+prefix+group+'($1,$2,$3,$4) AS value',[business,token,after,size]);assert.equal(page.businessId,business);assert.equal(page.snapshotToken,token);assert.equal(page.schemaVersion,expectedSchema);assert.equal(typeof page.hasMore,'boolean');assert(page[key].length<=size);for(const row of page[key]){assert(after===null||row.id>after);assert.equal(row.business_id,business);output.push(row);after=row.id;}if(!page.hasMore){done=true;break;}assert.equal(page[key].length,size);}assert(done);assert.equal(String(output.length),count);return output;}
 for(const group of Object.keys(quoteAmendmentCommercialTables))rows[group]=await pageAll('quote_commercial_snapshot_',suffix[group],group,scope.commercialSnapshotToken,scope.expectedCounts[group],1);
 const quotes={businessId:business,snapshotToken:scope.quoteReviewSnapshotToken,...scope.quoteCounts},counts={families:'expectedFamilyCount',revisions:'expectedRevisionCount',items:'expectedItemCount',assessments:'expectedAssessmentCount',approvals:'expectedApprovalCount'};
 for(const group of Object.keys(counts))quotes[group]=await pageAll(group==='revisions'?'quote_amendment_snapshot_':'quote_review_snapshot_',group,group,group==='revisions'?scope.snapshotToken:scope.quoteReviewSnapshotToken,scope.quoteCounts[counts[group]],group==='revisions'?1:2);
 const refs={leads:await references(c,business,'lead_snapshot_context','lead_snapshot_page','leads','rowCount'),leadEvents:await references(c,business,'lead_event_snapshot_context','lead_event_snapshot_page','events','rowCount'),conversions:await references(c,business,'lead_conversion_snapshot_context','lead_conversion_snapshot_page','conversions','conversionCount'),conversionLinks:await references(c,business,'lead_conversion_snapshot_context','conversion_link_snapshot_page','links','linkCount')};
 return {businessId:business,snapshotToken:scope.snapshotToken,commercialSnapshotToken:scope.commercialSnapshotToken,quoteReviewSnapshotToken:scope.quoteReviewSnapshotToken,expectedCounts:scope.expectedCounts,rows,quotes,references:refs,historyEvidence:await amendmentSourceHistory(c,business)};
}
