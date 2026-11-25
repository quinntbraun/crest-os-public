import 'server-only';
import registry from '../../supabase/migration-checksums.json' with {type:'json'};
declare const __CREST_SERVER_BUILD_IDENTITY__:string;
export type ServerBuildIdentity=Readonly<{schemaVersion:1;appReleaseId:string;sourceContentSha256:string;migrationRegistrySha256:string;sourceSchemaVersion:number}>;
// Rolldown replaces this marker with the actual content-derived build value.
// Unbundled source has no release identity and cannot invent one at startup.
const encoded=typeof __CREST_SERVER_BUILD_IDENTITY__==='string'?__CREST_SERVER_BUILD_IDENTITY__:undefined;
export function getServerBuildIdentity():ServerBuildIdentity|null{
 try{
  if(!encoded)return null;const value:unknown=JSON.parse(encoded);
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const record=value as Record<string,unknown>,fields=['schemaVersion','appReleaseId','sourceContentSha256','migrationRegistrySha256','sourceSchemaVersion'];
  if(Object.keys(record).length!==fields.length||!fields.every(key=>Object.hasOwn(record,key))||record.schemaVersion!==1||typeof record.sourceContentSha256!=='string'||!/^[a-f0-9]{64}$/.test(record.sourceContentSha256)||typeof record.migrationRegistrySha256!=='string'||!/^[a-f0-9]{64}$/.test(record.migrationRegistrySha256)||record.appReleaseId!==record.sourceContentSha256.slice(0,40)||!Number.isSafeInteger(record.sourceSchemaVersion)||(record.sourceSchemaVersion as number)<1)return null;
  return Object.freeze({...record}) as ServerBuildIdentity;
 }catch{return null;}
}
export function getServerMigrationIdentity(){
 const identity=getServerBuildIdentity();if(!identity||identity.sourceSchemaVersion!==registry.migrations.length)return null;
 return Object.freeze(registry.migrations.map(entry=>Object.freeze({version:entry.version,name:entry.file.slice(15,-4)})));
}
