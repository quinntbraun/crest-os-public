import {createHash} from 'node:crypto';

// Independent hand-built original evidence, never a round-trip through Number
// for PostgreSQL bigint versions. Synthetic IDs and identity metadata only.
export const identityId=(n:number)=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
export const identityDigest=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
export function identityFixture(){
 type Row=Record<string,unknown>;
 const businessId=identityId(100),bootstrap=identityId(1),owner=identityId(2),stamp='2026-10-24T07:00:00.123456+00:00';
 const original='2026-10-24T20:00:00.123456+13:00';let next=1000;
 const common=(who=owner)=>({created_at:stamp,updated_at:stamp,created_by:who,updated_by:who,origin:'manual',operation_id:null,import_row_id:null,version:'1'});
 const actors:Row[]=[{...common(bootstrap),id:bootstrap,kind:'system',display_label:'Synthetic bootstrap',system_key:'security_bootstrap',auth_provider_issuer:null,auth_user_id:null,current_security_epoch:identityId(3),disabled_at:null,origin:'system'},
  {...common(),id:owner,kind:'owner',display_label:'Synthetic owner',system_key:null,auth_provider_issuer:'https://auth.example.com/auth/v1',auth_user_id:identityId(4),current_security_epoch:identityId(5),disabled_at:null,created_by:bootstrap,version:'9007199254740993'}];
 const caps:Row[]=['crm.manage','export.bulk','finance.post','identity.manage','identity.read'].map((capability,i)=>({id:identityId(20+i),role:'owner',capability,created_at:stamp,created_by:bootstrap,origin:'system',operation_id:null,import_row_id:null}));
 const config:Record<string,Row[]>={businesses:[{...common(),id:businessId,legal_name:'Synthetic scope',currency:'USD',timezone:'America/Chicago',status:'setup'}],
  memberships:[{...common(),id:identityId(101),business_id:businessId,actor_id:owner,role:'owner',active:true}],
  business_recovery_authorities:[{...common(),id:identityId(102),business_id:businessId,active_epoch:identityId(103),writes_enabled:false,incident_id:null}]};
 const events:Row[]=[];
 const source=(value:Row)=>{const r={...value};for(const k of ['created_at','updated_at','disabled_at'])if(r[k]===stamp)r[k]=original;return r;};
 function bind(e:Row,before:Row|null,after:Row){
  e.payload=JSON.stringify({schemaVersion:1,id:e.id,businessId:e.business_id,createdBy:e.created_by,recordedAt:original,operationId:e.operation_id,entityKind:e.entity_kind,entityId:e.entity_id,entityVersion:e.entity_version,action:e.action,databasePrincipal:e.database_principal,before,after})
   .replace(/"(version|entityVersion)":"([0-9]+)"/g,'"$1":$2');
  e.event_hash=identityDigest(e.payload as string);return e;
 }
 function add(kind:string,after:Row,before:Row|null=null){const e:Row={id:identityId(next++),business_id:['actors','role_capabilities'].includes(kind)?null:businessId,created_at:stamp,created_by:after.updated_by??after.created_by,origin:'system',operation_id:after.operation_id,import_row_id:null,entity_kind:kind,entity_id:after.id,entity_version:after.version??'1',action:before?'UPDATE':'INSERT',database_principal:'synthetic_schema_operator'};bind(e,before&&source(before),source(after));events.push(e);return e;}
 for(const a of actors)add('actors',a);for(const c of caps)add('role_capabilities',c);for(const [kind,rows] of Object.entries(config))for(const r of rows)add(kind,r);
 const old={...actors[1]!};Object.assign(actors[1]!,{version:'9007199254740994',display_label:'Synthetic updated owner'});add('actors',actors[1]!,old);
 const updated={...actors[1]!};Object.assign(actors[1]!,{version:'9007199254740995',disabled_at:stamp});add('actors',actors[1]!,updated);
 type Envelope={kind:string;recordId:string;representation:string;canonicalEvidence:string;evidenceHash:string};
 const collection={formatVersion:1,assurance:'snapshot_bytes_only',generationId:identityId(200),context:{schemaVersion:1,scope:'business_identity',businessId,snapshotToken:'a'.repeat(64),observedAt:stamp,recordCounts:{actor:'0',role_capability:'0',identity_event:'0'}},evidenceBytes:0,records:[] as Envelope[]};
 function record(kind:string,row:Row):Envelope{const canonicalEvidence=JSON.stringify({schemaVersion:1,kind,businessId,jsonTextColumns:kind==='identity_event'?['payload']:[],row});return {kind,recordId:row.id as string,representation:'snapshot_projection',canonicalEvidence,evidenceHash:identityDigest(canonicalEvidence)};}
 function refresh(){collection.records=[...actors.map(a=>record('actor',a)),...caps.map(c=>record('role_capability',c)),...events.map(e=>record('identity_event',e))];sort();for(const k of ['actor','role_capability','identity_event'] as const)collection.context.recordCounts[k]=String(collection.records.filter(r=>r.kind===k).length);}
 function sort(){const kinds=['actor','role_capability','identity_event'];collection.records.sort((a,b)=>kinds.indexOf(a.kind)-kinds.indexOf(b.kind)||(a.recordId<b.recordId?-1:a.recordId>b.recordId?1:0));}
 function encode(){collection.evidenceBytes=collection.records.reduce((n,r)=>n+Buffer.byteLength(r.canonicalEvidence),0);return JSON.stringify(collection);}
 refresh();return {businessId,bootstrap,owner,stamp,original,actors,caps,config,events,collection,add,bind,record,refresh,sort,encode};
}
