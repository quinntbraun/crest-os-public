import {CustomerDataError,customerUuid,parseCustomerDraft} from './customer-contract.ts';
import {parseVehicleDraft,vehicleVinHint} from './customer-resource-contract.ts';

export const legacyContactFields=['customerSourceId','displayName','phone','email','customerSince','outreachOptOut','customerNotes',
 'vehicleSourceId','vehicleLabel','vehicleYear','vehicleMake','vehicleModel','vehicleColor','vehicleVin','vehiclePlate'] as const;
type Field=typeof legacyContactFields[number];
export type LegacyContactColumnMap=Readonly<Partial<Record<Field,string>>>;
type ContactHint=Readonly<{id:string;businessId:string;phone:string|null;email:string|null}>;
type VehicleHint=Readonly<{id:string;businessId:string;vin:string|null}>;
type KnownRecords=Readonly<{contacts:readonly ContactHint[];vehicles:readonly VehicleHint[]}>;
export const maximumLegacyCsvBytes=25*1024*1024;
export const maximumLegacyCsvRows=100000;
const vehicleFields=legacyContactFields.slice(7);

export class LegacyContactImportError extends Error {
 constructor(message:string){super(message);this.name='LegacyContactImportError';}
}
function require(value:unknown,message:string):asserts value{if(!value)throw new LegacyContactImportError(message);}
async function hash(data:string|Uint8Array){
 const input=typeof data==='string'?new TextEncoder().encode(data):new Uint8Array(data);
 const digest=await crypto.subtle.digest('SHA-256',input);
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
const phoneHint=(value:string|null)=>value?.replace(/[^0-9]/g,'')||null;
const emailHint=(value:string|null)=>value?.normalize('NFC').toLowerCase()||null;

function* csvRecords(file:Uint8Array):Generator<string[]>{
 require(file instanceof Uint8Array&&file.byteLength>0&&file.byteLength<=maximumLegacyCsvBytes,'LEGACY_CSV_SIZE_REQUIRED');
 let text:string;
 try{text=new TextDecoder('utf-8',{fatal:true}).decode(file);}catch{throw new LegacyContactImportError('LEGACY_CSV_UTF8_REQUIRED');}
 require(text.length>0&&!text.includes('\0'),'LEGACY_CSV_UTF8_REQUIRED');
 type State='field_start'|'unquoted'|'quoted'|'after_quote';
 let state:State='field_start',start=0,quotedEnd=0,parts:string[]=[],row:string[]=[];
 const appendField=(end:number,nextStart:number)=>{
  const suffix=text.slice(start,state==='after_quote'?quotedEnd:end);
  if(parts.length){parts.push(suffix);row.push(parts.join(''));}else row.push(suffix);
  parts=[];start=nextStart;state='field_start';
 };
 const appendRow=(end:number,nextStart:number)=>{
  appendField(end,nextStart);
  const finished=row;
  row=[];
  return finished;
 };
 for(let index=0;index<text.length;index++){
  const character=text[index]!;
  if(state==='quoted'){
   if(character==='"'&&text[index+1]==='"'){
    parts.push(text.slice(start,index+1));
    start=++index+1;
   }else if(character==='"'){quotedEnd=index;state='after_quote';}
   continue;
  }
  if(character===','){appendField(index,index+1);continue;}
  if(character==='\n'||character==='\r'){
   const end=index;
   if(character==='\r'){
    require(text[index+1]==='\n','LEGACY_CSV_LINE_ENDING_REQUIRED');
    index++;
   }
   yield appendRow(end,index+1);
   continue;
  }
  if(character==='"'){
   require(state==='field_start','LEGACY_CSV_QUOTE_REQUIRED');
   start=index+1;state='quoted';
   continue;
  }
  require(state!=='after_quote','LEGACY_CSV_QUOTE_REQUIRED');
  state='unquoted';
 }
 require(state!=='quoted','LEGACY_CSV_QUOTE_REQUIRED');
 if(row.length||state!=='field_start')yield appendRow(text.length,text.length);
}

function csvRows(file:Uint8Array){
 const records=csvRecords(file),first=records.next();
 require(!first.done,'LEGACY_CSV_HEADER_REQUIRED');
 const headers=first.value;
 require(headers.every(header=>header.trim().length>0)&&new Set(headers).size===headers.length,'LEGACY_CSV_HEADER_REQUIRED');
 function* dataRows(){
  let count=0;
  for(const row of records){
   require(++count<=maximumLegacyCsvRows,'LEGACY_CSV_ROW_LIMIT');
   require(row.length===headers.length,'LEGACY_CSV_ROW_WIDTH_REQUIRED');
   yield row;
  }
 }
 return {headers,rows:dataRows()};
}

function columnSelection(headers:readonly string[],input:LegacyContactColumnMap){
 require(input&&typeof input==='object'&&!Array.isArray(input),'LEGACY_IMPORT_MAPPING_REQUIRED');
 const known=new Set<string>(legacyContactFields),used=new Set<string>();
 const columns=new Map<Field,number>();
 for(const [field,header] of Object.entries(input)){
  require(known.has(field)&&typeof header==='string'&&headers.includes(header)&&!used.has(header),'LEGACY_IMPORT_MAPPING_REQUIRED');
  used.add(header);
  columns.set(field as Field,headers.indexOf(header));
 }
 require(columns.has('customerSourceId')&&columns.has('displayName'),'LEGACY_IMPORT_CONTACT_MAPPING_REQUIRED');
 if(vehicleFields.some(field=>columns.has(field)))
  require(columns.has('vehicleSourceId')&&columns.has('vehicleLabel'),'LEGACY_IMPORT_VEHICLE_MAPPING_REQUIRED');
 return {columns,unmappedHeaders:headers.filter(header=>!used.has(header))};
}

function importSourceId(value:string|null){
 require(value!==null&&[...value].length<=200&&value===value.trim()&&[...value].every(character=>{
  const code=character.charCodeAt(0);return code>=32&&code!==127;
 }),'LEGACY_SOURCE_ID_REQUIRED');
 return value;
}

function mappedRow(row:readonly string[],columns:ReadonlyMap<Field,number>){
 const cell=(field:Field)=>{
  const index=columns.get(field);
  return index===undefined?null:row[index]||null;
 };
 const customerSourceId=importSourceId(cell('customerSourceId'));
 const rawOptOut=cell('outreachOptOut');
 require(rawOptOut===null||rawOptOut==='true'||rawOptOut==='false','LEGACY_OUTREACH_VALUE_REQUIRED');
 const validated=parseCustomerDraft({displayName:cell('displayName'),phone:cell('phone'),email:cell('email'),
  customerSince:cell('customerSince'),outreachOptOut:rawOptOut==='true',contactPreference:null,notes:cell('customerNotes'),
  archived:false,archiveReason:null});
 const customer={...validated,outreachOptOut:rawOptOut===null?null:validated.outreachOptOut};
 if(!vehicleFields.some(field=>cell(field)!==null))return {customerSourceId,customer,vehicle:null};
 const vehicleSourceId=importSourceId(cell('vehicleSourceId'));
 const year=cell('vehicleYear');
 require(year===null||/^\d{4}$/.test(year),'LEGACY_VEHICLE_YEAR_REQUIRED');
 const vehicle=parseVehicleDraft({label:cell('vehicleLabel'),year:year===null?null:Number(year),make:cell('vehicleMake'),
  model:cell('vehicleModel'),color:cell('vehicleColor'),vin:cell('vehicleVin'),plate:cell('vehiclePlate'),
  kind:'customer_vehicle',notes:null,archived:false,archiveReason:null});
 return {customerSourceId,customer,vehicle:{sourceId:vehicleSourceId,draft:vehicle}};
}

type MappedRow=ReturnType<typeof mappedRow>;
type RowIssue=Readonly<{row:number;reason:string}>;
function put<K,V>(index:Map<K,Set<V>>,key:K|null,value:V){
 if(key===null)return;
 const values=index.get(key)??new Set<V>();
 values.add(value);
 index.set(key,values);
}
async function shortlist<K,V extends string>(index:ReadonlyMap<K,Set<V>>,includeSingle:boolean){
 return new Map(await Promise.all([...index].filter(([,ids])=>includeSingle||ids.size>1).map(async([key,ids])=>{
  const sorted=[...ids].sort();
  return [key,{ids,first:sorted.slice(0,6),evidenceSha256:await hash(JSON.stringify(sorted))}] as const;
 })));
}
function related<K,V extends string>(index:Awaited<ReturnType<typeof shortlist<K,V>>>,key:K|null,self?:V){
 const match=key===null?undefined:index.get(key);
 const candidateCount=match?match.ids.size-Number(self!==undefined&&match.ids.has(self)):0;
 return {candidateCount,firstCandidates:match?.first.filter(id=>id!==self).slice(0,5)??[],
  evidenceSha256:candidateCount?(match?.evidenceSha256??null):null};
}

export function inspectLegacyContactFile(file:Uint8Array){
 const {headers,rows}=csvRows(file);
 let sourceRowCount=0;
 for(let next=rows.next();!next.done;next=rows.next())sourceRowCount++;
 return {headers,sourceRowCount};
}

// Preview a selected CSV mapping. Original IDs, row positions, and raw contact
// values survive review. No inferred ownership, merge, import, or consent.
export async function previewLegacyContacts(file:Uint8Array,mapping:LegacyContactColumnMap,businessId:string,
 known:KnownRecords={contacts:[],vehicles:[]}){
 require(customerUuid(businessId),'LEGACY_IMPORT_BUSINESS_REQUIRED');
 require(file instanceof Uint8Array&&file.byteLength>0&&file.byteLength<=maximumLegacyCsvBytes,'LEGACY_CSV_SIZE_REQUIRED');
 const source=new Uint8Array(file);
 const {headers,rows}=csvRows(source);
 const {columns,unmappedHeaders}=columnSelection(headers,mapping);
 const mapped:(MappedRow&{row:number})[]=[],issues:RowIssue[]=[];
 let sourceRowCount=0;
 for(const row of rows){
  const sourceRow=++sourceRowCount+1;
  try{mapped.push({row:sourceRow,...mappedRow(row,columns)});}
  catch(error){
   if(!(error instanceof LegacyContactImportError||error instanceof CustomerDataError))throw error;
   issues.push({row:sourceRow,reason:error instanceof LegacyContactImportError?error.message:'LEGACY_IMPORT_ROW_REVIEW_REQUIRED'});
  }
 }
 const contacts=new Map<string,MappedRow['customer']>(),vehicles=new Map<string,NonNullable<MappedRow['vehicle']>>();
 const phones=new Map<string,Set<string>>(),emails=new Map<string,Set<string>>(),vins=new Map<string,Set<string>>();
 const vehicleContacts=new Map<string,Set<string>>();
 const existingPhones=new Map<string,Set<string>>(),existingEmails=new Map<string,Set<string>>(),existingVins=new Map<string,Set<string>>();
 for(const record of known.contacts){
  require(record.businessId===businessId&&customerUuid(record.id),'LEGACY_IMPORT_BUSINESS_REQUIRED');
  put(existingPhones,phoneHint(record.phone),record.id);
  put(existingEmails,emailHint(record.email),record.id);
 }
 for(const record of known.vehicles){
  require(record.businessId===businessId&&customerUuid(record.id),'LEGACY_IMPORT_BUSINESS_REQUIRED');
  put(existingVins,vehicleVinHint(record.vin),record.id);
 }
 for(const {customerSourceId,customer,vehicle,row} of mapped){
  const prior=contacts.get(customerSourceId);
  if(prior&&JSON.stringify(prior)!==JSON.stringify(customer))issues.push({row,reason:'LEGACY_CONTACT_SOURCE_CONFLICT'});
  else contacts.set(customerSourceId,customer);
  put(phones,phoneHint(customer.phone),customerSourceId);
  put(emails,emailHint(customer.email),customerSourceId);
  if(vehicle){
   const previous=vehicles.get(vehicle.sourceId);
   if(previous&&JSON.stringify(previous)!==JSON.stringify(vehicle))issues.push({row,reason:'LEGACY_VEHICLE_SOURCE_CONFLICT'});
   else vehicles.set(vehicle.sourceId,vehicle);
   put(vins,vehicleVinHint(vehicle.draft.vin),vehicle.sourceId);
   put(vehicleContacts,vehicle.sourceId,customerSourceId);
  }
 }
 const [phoneMatches,emailMatches,vinMatches,ownerMatches,existingPhoneMatches,existingEmailMatches,existingVinMatches,sourceSha256]=await Promise.all([
  shortlist(phones,false),shortlist(emails,false),shortlist(vins,false),shortlist(vehicleContacts,false),
  shortlist(existingPhones,true),shortlist(existingEmails,true),shortlist(existingVins,true),hash(source),
 ]);
 issues.sort((left,right)=>left.row-right.row);
 const selections=Object.fromEntries(legacyContactFields.filter(field=>columns.has(field)).map(field=>[field,headers[columns.get(field)!]]));
 const review={schemaVersion:1,scope:'legacy_contacts_and_vehicles_review',businessId,sourceSha256,
  headers,unmappedHeaders,mapping:selections,sourceRowCount,issues,
  rows:mapped.map(entry=>{
   const {customer,customerSourceId,vehicle}=entry;
   const phone=phoneHint(customer.phone),email=emailHint(customer.email),vin=vehicle?vehicleVinHint(vehicle.draft.vin):null;
   return {...entry,duplicateReview:{
    sourceContactPhone:related(phoneMatches,phone,customerSourceId),sourceContactEmail:related(emailMatches,email,customerSourceId),
    sourceVehicleVin:related(vinMatches,vin,vehicle?.sourceId),
    otherSourceContactsForVehicle:related(ownerMatches,vehicle?.sourceId??null,customerSourceId),
    existingContactPhone:related(existingPhoneMatches,phone),existingContactEmail:related(existingEmailMatches,email),
    existingVehicleVin:related(existingVinMatches,vin),
   }};
  })};
 return {...review,previewSha256:await hash(JSON.stringify(review))};
}
