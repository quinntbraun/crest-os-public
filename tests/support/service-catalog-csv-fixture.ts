// Independent neutral reader for tests only. No production import authority.
import {readCustomerCsv} from './customer-fixture.ts';
export function decodeServiceCatalogCsv(csv:string,escapeMap:string,entity:'services'|'service_versions'){
 const matrix=readCustomerCsv(csv),headers=matrix.shift()!,map=JSON.parse(escapeMap).escapes as {entity:string;row_id:string;column:string}[];
 return matrix.map(cells=>Object.fromEntries(headers.map((column,i)=>{
  let value:string|boolean|null=cells[i]!;
  if(value==='\\N')value=null;
  else{
   if(map.some(e=>e.entity===entity&&e.row_id===cells[headers.indexOf('id')]&&e.column===column)){if(!value.startsWith("'"))throw Error('MISSING_DECLARED_ESCAPE');value=value.slice(1);}
   value=value.replaceAll('\\\\','\\');
   if(entity==='services'&&column==='active'){if(!['true','false'].includes(value))throw Error('INVALID_BOOLEAN');value=value==='true';}
  }
  return [column,value];
 })));
}
