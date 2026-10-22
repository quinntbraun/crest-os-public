import {binding,exact,renameInput,uuid} from './business-settings';
import type {Rename} from './business-settings';
export const pendingEditKey='crest.business-name.pending.v1';
export type PendingEdit=Readonly<{journalSchema:1;businessId:string;binding:string;command:Rename}>;
export class PendingEditError extends Error{constructor(){super('PENDING_EDIT_STORAGE_FAILED');this.name='PendingEditError';}}
export function pendingEdit(value:unknown):PendingEdit{
  if(!exact(value,['journalSchema','businessId','binding','command'])||value.journalSchema!==1||typeof value.businessId!=='string'||!uuid.test(value.businessId)
    ||typeof value.binding!=='string'||!binding.test(value.binding)||!renameInput(value.command))throw new PendingEditError();
  return Object.freeze({journalSchema:1,businessId:value.businessId,binding:value.binding,command:Object.freeze({...value.command})});
}
// One bounded per-tab name intent, never cookies/proofs/provider credentials,
// a financial queue, cross-tab cache or an authorization ticket. No TTL purge.
export function createPendingEditStore(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
  function read():PendingEdit|null{
    try{const raw=storage.getItem(pendingEditKey);if(raw===null)return null;if(raw.length>8192)throw new Error();return pendingEdit(JSON.parse(raw));}catch{throw new PendingEditError();}
  }
  function same(a:PendingEdit|null,b:PendingEdit){return a!==null&&JSON.stringify(a)===JSON.stringify(b);}
  return Object.freeze({read,
    write(value:PendingEdit){try{const pinned=pendingEdit(value);if(read()!==null)throw new Error();storage.setItem(pendingEditKey,JSON.stringify(pinned));if(!same(read(),pinned))throw new Error();}catch{throw new PendingEditError();}},
    require(value:PendingEdit){if(!same(read(),pendingEdit(value)))throw new PendingEditError();},
    clear(value:PendingEdit){try{if(!same(read(),pendingEdit(value)))throw new Error();storage.removeItem(pendingEditKey);if(read()!==null)throw new Error();}catch{throw new PendingEditError();}}
  });
}
