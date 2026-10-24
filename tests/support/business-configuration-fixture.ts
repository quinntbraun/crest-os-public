import {identityFixture,identityDigest as digest} from './business-identity-fixture.ts';
import {historyFixture} from './business-history-fixture.ts';

export function configurationFixture(){
 const identity=identityFixture(),history=historyFixture(),expected={businessId:identity.businessId},kinds=['business','membership','recovery_authority'],tables=['businesses','memberships','business_recovery_authorities'];
 Object.assign(history.collection,{generationId:identity.collection.generationId});Object.assign(history.collection.context,{businessId:identity.businessId});
 Object.assign(history.operation,{business_id:identity.businessId,actor_id:identity.owner,created_by:identity.owner});Object.assign(history.audit,{business_id:identity.businessId,entity_id:identity.businessId,actor_id:identity.owner,created_by:identity.owner});
 const originalRefresh=history.refresh;history.refresh=()=>{originalRefresh();for(const r of history.collection.records){const b=JSON.parse(r.canonicalEvidence);b.businessId=identity.businessId;r.canonicalEvidence=JSON.stringify(b);r.evidenceHash=digest(r.canonicalEvidence);}return history.encode();};history.bindAudit();history.refresh();
 const collection={formatVersion:1,assurance:'snapshot_bytes_only',generationId:identity.collection.generationId,context:{schemaVersion:1,scope:'business_configuration',businessId:identity.businessId,snapshotToken:'c'.repeat(64),observedAt:identity.stamp,recordCounts:{business:'1',membership:'1',recovery_authority:'1'}},evidenceBytes:0,records:[] as {kind:string;recordId:string;representation:string;canonicalEvidence:string;evidenceHash:string}[]};
 function record(kind:string,row:Record<string,unknown>){const canonicalEvidence=JSON.stringify({schemaVersion:1,kind,businessId:identity.businessId,row});return {kind,recordId:row.id as string,representation:'snapshot_projection',canonicalEvidence,evidenceHash:digest(canonicalEvidence)};}
 function refresh(){collection.records=kinds.flatMap((k,i)=>identity.config[tables[i]!]!.map(row=>record(k,row)));for(const k of kinds)Object.assign(collection.context.recordCounts,{[k]:String(collection.records.filter(r=>r.kind===k).length)});}
 function encode(){collection.evidenceBytes=collection.records.reduce((n,r)=>n+Buffer.byteLength(r.canonicalEvidence),0);return JSON.stringify(collection);}
 refresh();return {identity,history,expected,collection,record,refresh,encode};
}
