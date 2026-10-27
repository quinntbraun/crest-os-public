import {customerUuid as uuid} from '../customer/customer-contract.ts';
export type SourceExportOwnerContext=Readonly<{schemaVersion:1;businessId:string;actorId:string;appReleaseId:string;profile:'crest.business-source-journal-bundle.v1';sourceSchemaVersion:43}&({writeState:'ready';recoveryEpoch:string}|{writeState:'paused';recoveryEpoch:null})>;
export function parseSourceExportOwnerContext(input:unknown):SourceExportOwnerContext{
 try{
  if(!input||typeof input!=='object'||Array.isArray(input)||(Object.getPrototypeOf(input)!==Object.prototype&&Object.getPrototypeOf(input)!==null))throw Error();
  const keys=['schemaVersion','businessId','actorId','appReleaseId','profile','sourceSchemaVersion','writeState','recoveryEpoch'],d=Object.getOwnPropertyDescriptors(input);
  if(Reflect.ownKeys(d).length!==keys.length||!keys.every(k=>Object.hasOwn(d,k)&&d[k]!.enumerable&&Object.hasOwn(d[k]!,'value')))throw Error();
  const v=Object.fromEntries(keys.map(k=>[k,d[k]!.value]));
  if(v.schemaVersion!==1||!uuid(v.businessId)||!uuid(v.actorId)||typeof v.appReleaseId!=='string'||!/^[a-f0-9]{40}$/.test(v.appReleaseId)||v.profile!=='crest.business-source-journal-bundle.v1'||v.sourceSchemaVersion!==43||!(v.writeState==='ready'&&uuid(v.recoveryEpoch)||v.writeState==='paused'&&v.recoveryEpoch===null))throw Error();
  return Object.freeze(v) as SourceExportOwnerContext;
 }catch{throw Error('SOURCE_EXPORT_CONTEXT_REVIEW_REQUIRED');}
}
