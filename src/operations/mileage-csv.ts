// Isolated server/export tooling for one validated mileage history page.
import {createHash} from 'node:crypto';
import {parseMileageHistoryPage} from './mileage-history.ts';
import {mileageExportByteLimit,mileageExportFiles,mileageExportManifest} from './mileage-export-data.ts';

const hash=(content:string)=>createHash('sha256').update(content,'utf8').digest('hex');

export function formatMileageHistoryCsv(value:unknown,binding:Parameters<typeof parseMileageHistoryPage>[1]){
 const page=parseMileageHistoryPage(value,binding);
 const snapshot=JSON.stringify(page)+'\n',snapshotToken=hash(snapshot);
 const files=mileageExportFiles(page,snapshot,snapshotToken);
 const parts=Object.entries(files).map(([name,content])=>({name,bytes:Buffer.byteLength(content),sha256:hash(content)}));
 if(parts.reduce((bytes,part)=>bytes+part.bytes,0)>mileageExportByteLimit)throw Error('MILEAGE_EXPORT_TOO_LARGE');
 return Object.freeze({page,files,manifest:mileageExportManifest(page,snapshotToken,parts)});
}
