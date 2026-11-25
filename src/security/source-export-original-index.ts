import 'server-only';
import {createHash} from 'node:crypto';
import type {currentAttachmentInventory} from './current-attachment-inventory.ts';
export function createExportOriginalIndex(inventory:ReturnType<typeof currentAttachmentInventory>,inventoryBytes:Uint8Array){
 if(!Buffer.from(inventoryBytes).equals(Buffer.from(JSON.stringify(inventory)+'\n')))throw Error('SOURCE_EXPORT_ORIGINAL_INDEX_REVIEW_REQUIRED');
 const files=inventory.attachments.filter(item=>item.status==='available').map(item=>{
  if(!item.original)throw Error('SOURCE_EXPORT_ORIGINAL_INDEX_REVIEW_REQUIRED');
  const f=item.original;return Object.freeze({kind:item.kind,attachmentId:item.attachmentId,objectId:f.objectId,path:f.path,mediaType:f.mediaType,byteSize:f.byteSize,sha256:f.sha256,recordedAt:item.recordedAt});
 });
 const value=Object.freeze({profile:'crest.source-export-original-index.v1' as const,inventorySha256:createHash('sha256').update(inventoryBytes).digest('hex'),files:Object.freeze(files)});
 if(Buffer.byteLength(JSON.stringify(value))>33554432)throw Error('SOURCE_EXPORT_ORIGINAL_INDEX_REVIEW_REQUIRED');return value;
}
export type ExportOriginalIndex=ReturnType<typeof createExportOriginalIndex>;
