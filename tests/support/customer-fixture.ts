import type {Customer} from '../../src/customer/customer-contract.ts';
export const customerBusiness='11111111-1111-4111-8111-111111111111';
export function customerFixture(patch:Partial<Customer>={}):Customer{return {id:'22222222-2222-4222-8222-222222222222',business_id:customerBusiness,display_name:'Synthetic customer',phone_raw:null,phone_normalized:null,email_raw:null,email_normalized:null,contact_preference:null,outreach_opt_out:false,notes:null,customer_since:null,archived_at:null,archived_reason:null,version:'1',created_at:'2026-10-24T01:02:03.123456Z',updated_at:'2026-10-24T01:02:03.123456Z',created_by:'33333333-3333-4333-8333-333333333333',updated_by:'33333333-3333-4333-8333-333333333333',origin:'manual',operation_id:'44444444-4444-4444-8444-444444444444',import_row_id:null,...patch};}
// Independent RFC4180 reader for round-trip assertions, not product import code.
export function readCustomerCsv(text:string){
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i]!;
    if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"')quoted=false;else cell+=ch;}
    else if(ch==='"'){if(cell!=='')throw new Error('invalid quote');quoted=true;}
    else if(ch===','){row.push(cell);cell='';}
    else if(ch==='\r'&&text[i+1]==='\n'){row.push(cell);rows.push(row);row=[];cell='';i++;}
    else throw new Error('expected a quoted field or CRLF');
  }
  if(quoted||cell||row.length)throw new Error('incomplete CSV');return rows;
}
export function decodeCustomerCsv(csv:string,escapeMap:string){
  const matrix=readCustomerCsv(csv),headers=matrix.shift()!,escapes=JSON.parse(escapeMap).escapes as {row_id:string;column:string}[],slash=String.fromCharCode(92);
  return matrix.map(cells=>Object.fromEntries(headers.map((column,i)=>{
    let value:string|boolean|null=cells[i]!;
    if(value===slash+'N')value=null;
    else {if(escapes.some(e=>e.row_id===cells[headers.indexOf('id')]&&e.column===column)){if(!value.startsWith("'"))throw new Error('missing escape');value=value.slice(1);}value=value.replaceAll(slash+slash,slash);if(column==='outreach_opt_out'){if(!['true','false'].includes(value))throw new Error('invalid boolean');value=value==='true';}}
    return [column,value];
  })));
}
