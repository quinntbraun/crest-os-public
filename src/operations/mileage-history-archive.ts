import {zipSync} from 'fflate';
import {parseMileageHistoryPage} from './mileage-history.ts';
import {mileageExportByteLimit,mileageExportFiles,mileageExportManifest} from './mileage-export-data.ts';

async function sha256(bytes:Uint8Array<ArrayBuffer>){
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}

export async function buildMileageHistoryArchive(value:unknown,binding:Parameters<typeof parseMileageHistoryPage>[1]){
 const page=parseMileageHistoryPage(value,binding),encoder=new TextEncoder();
 const snapshot=JSON.stringify(page)+'\n',snapshotToken=await sha256(encoder.encode(snapshot));
 const files=mileageExportFiles(page,snapshot,snapshotToken),data:Record<string,Uint8Array<ArrayBuffer>>={};
 const parts=[];
 let size=0;
 for(const [name,content]of Object.entries(files)){
  const bytes=encoder.encode(content);
  size+=bytes.byteLength;
  if(size>mileageExportByteLimit)throw Error('MILEAGE_EXPORT_TOO_LARGE');
  data[name]=bytes;
  parts.push({name,bytes:bytes.byteLength,sha256:await sha256(bytes)});
 }
 data['manifest.json']=encoder.encode(mileageExportManifest(page,snapshotToken,parts));
 const zipped=zipSync(data,{level:0});
 if(zipped.byteLength>mileageExportByteLimit)throw Error('MILEAGE_EXPORT_TOO_LARGE');
 return new Uint8Array(zipped);
}
