import {recoveryFixture,encode as encodeRecovery,digest} from './provider-recovery-fixture.ts';

// Independent synthetic metadata paired with retained originals; no live IDs.
export function sessionMetadataFixture(tracked=true,revoked=true){
 const recovery=recoveryFixture(tracked,revoked),expected=recovery.expected;
 const last=JSON.parse((revoked?recovery.stoppedEvent:recovery.created).canonicalEvidence).after;
 const row:Record<string,unknown>={...last,provider_session_id:JSON.parse(recovery.mapping.canonicalEvidence).providerSessionId,updated_at:recovery.revocation,version:String(last.version)};
 const collection={formatVersion:1,assurance:'snapshot_bytes_only',generationId:recovery.collection.generationId,
  context:{schemaVersion:1,scope:'application_session_metadata',actorId:expected.actorId,providerIssuer:expected.issuer,snapshotToken:'c'.repeat(64),observedAt:recovery.revocation,recordCount:'1'},
  evidenceBytes:0,records:[] as {kind:string;recordId:string;representation:string;canonicalEvidence:string;evidenceHash:string}[]};
 function record(value:Record<string,unknown>){const canonicalEvidence=JSON.stringify({schemaVersion:1,scope:'application_session_metadata',actorId:expected.actorId,providerIssuer:expected.issuer,jsonTextColumns:[],row:value});return {kind:'session_metadata',recordId:value.id as string,representation:'snapshot_projection',canonicalEvidence,evidenceHash:digest(canonicalEvidence)};}
 function refresh(){collection.records=[record(row)];collection.context.recordCount='1';}
 function encodeMetadata(){collection.evidenceBytes=collection.records.reduce((n,r)=>n+Buffer.byteLength(r.canonicalEvidence),0);return JSON.stringify(collection);}
 const encodeProvider=()=>encodeRecovery(recovery);
 refresh();return {recovery,expected,row,collection,refresh,record,encodeMetadata,encodeProvider};
}
