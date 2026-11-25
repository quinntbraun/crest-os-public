// Versioned data-only reconstruction for selected/downloaded export parts.
// No requests, storage credentials, owner authority or file-system paths.
export type CurrentLogicalBinding=Readonly<{businessId:string;generationId:string;appReleaseId:string;sourceSchemaVersion:134|135|136|137|138|140|141|142}>;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,hash=/^[a-f0-9]{64}$/;
const decoder=new TextDecoder('utf-8',{fatal:true}),encoder=new TextEncoder();
function require(value:unknown):asserts value{if(!value)throw Error('CURRENT_SOURCE_LOGICAL_FILES_REVIEW_REQUIRED');}
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{require(value!==null&&typeof value==='object'&&!Array.isArray(value));const fields=Object.getOwnPropertyDescriptors(value);require(Reflect.ownKeys(fields).length===keys.length&&keys.every(key=>fields[key]?.enumerable&&Object.hasOwn(fields[key]!,'value')));return Object.fromEntries(keys.map(key=>[key,fields[key]!.value]));}
const integer=(value:unknown,min:number,max:number):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max;
async function digest(bytes:Uint8Array){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))),value=>value.toString(16).padStart(2,'0')).join('');}
function contentType(name:string){return name.endsWith('.xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':name.endsWith('.csv')?'text/csv; charset=utf-8':name.endsWith('.json')?'application/json':'text/plain; charset=utf-8';}
export async function readCurrentSourceLogicalFiles(manifest:string,parts:readonly Readonly<{name:string;bytes:Uint8Array}>[],binding:CurrentLogicalBinding,signal:AbortSignal){
 return readLogicalFiles(manifest,parts,binding,signal);
}
export async function readCurrentSourceLogicalSelection(manifest:string,parts:readonly Readonly<{name:string;bytes:Uint8Array}>[],binding:CurrentLogicalBinding,names:readonly string[],signal:AbortSignal){
 return readLogicalFiles(manifest,parts,binding,signal,names);
}
export async function describeCurrentSourceLogicalFiles(manifest:string,binding:CurrentLogicalBinding,signal:AbortSignal){
 await readLogicalFiles(manifest,[],binding,signal,[]);
 const root=JSON.parse(manifest) as {files:{name:string;contentType:string;bytes:number;sha256:string;parts:{name:string;bytes:number;sha256:string}[]}[]};
 return Object.freeze(root.files.map(file=>Object.freeze({name:file.name,contentType:file.contentType,bytes:file.bytes,sha256:file.sha256,parts:Object.freeze(file.parts.map(part=>Object.freeze({name:part.name,bytes:part.bytes,sha256:part.sha256})))})));
}
async function readLogicalFiles(manifest:string,parts:readonly Readonly<{name:string;bytes:Uint8Array}>[],binding:CurrentLogicalBinding,signal:AbortSignal,selection?:readonly string[]){
 const output:{name:string;contentType:string;bytes:Uint8Array}[]=[];
 try{
  require(!signal.aborted&&typeof manifest==='string'&&encoder.encode(manifest).length<=4194304&&Array.isArray(parts)&&parts.length>=(selection?0:1)&&parts.length<=1024);
  const wanted=selection?new Set(selection):undefined;require(!wanted||wanted.size===selection!.length&&wanted.size<=1024);
  const expected=object(binding,['businessId','generationId','appReleaseId','sourceSchemaVersion']);require(uuid.test(String(expected.businessId))&&uuid.test(String(expected.generationId))&&typeof expected.appReleaseId==='string'&&/^[a-f0-9]{40}$/.test(expected.appReleaseId)&&(expected.sourceSchemaVersion===134||expected.sourceSchemaVersion===135||expected.sourceSchemaVersion===136||expected.sourceSchemaVersion===137||expected.sourceSchemaVersion===138||expected.sourceSchemaVersion===140||(expected.sourceSchemaVersion===141||expected.sourceSchemaVersion===142)));
  const root=object(JSON.parse(manifest),['formatVersion','profile','businessId','generationId','appReleaseId','sourceSchemaVersion','observedAt','totalEncodedBytes','totalDecodedBytes','files','completePortableExport','completeBackup']);
  require(JSON.stringify(root)+'\n'===manifest);
  require(root.formatVersion===1&&root.profile==='crest.current-source-logical-files.v1'&&Object.keys(expected).every(key=>root[key]===expected[key])&&root.completePortableExport===false&&root.completeBackup===false&&typeof root.observedAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}\+00:00$/.test(root.observedAt)&&Number.isFinite(Date.parse(root.observedAt)));
  require(integer(root.totalEncodedBytes,1,67108864)&&integer(root.totalDecodedBytes,1,67108864)&&Array.isArray(root.files)&&root.files.length>=1&&root.files.length<=1024);
  const physical=new Map<string,Uint8Array>();let supplied=0;
  for(const part of parts){require(typeof part.name==='string'&&/^current_file_\d{4}_part_\d{4}\.txt$/.test(part.name)&&!physical.has(part.name)&&part.bytes instanceof Uint8Array&&part.bytes.length>=1&&part.bytes.length<=4194304);supplied+=part.bytes.length;require(supplied<=67108864);physical.set(part.name,part.bytes);}
  const used=new Set<string>(),names=new Set<string>(),declared=new Set<string>();let encodedTotal=0,decodedTotal=0,selectedEncoded=0;
  for(const raw of root.files){
   require(!signal.aborted);const file=object(raw,['name','contentType','encoding','bytes','sha256','encodedBytes','encodedSha256','parts']);
   require(typeof file.name==='string'&&/^[a-z][a-z0-9_]{0,79}\.(csv|json|txt|xlsx)$/.test(file.name)&&!names.has(file.name)&&file.contentType===contentType(file.name));names.add(file.name);
   require(file.encoding===(file.name.endsWith('.xlsx')?'base64':'utf8')&&integer(file.bytes,1,33554432)&&typeof file.sha256==='string'&&hash.test(file.sha256)&&integer(file.encodedBytes,1,50331648)&&typeof file.encodedSha256==='string'&&hash.test(file.encodedSha256)&&Array.isArray(file.parts)&&file.parts.length>=1&&file.parts.length<=1024);
   encodedTotal+=file.encodedBytes;decodedTotal+=file.bytes;require(encodedTotal<=67108864&&decodedTotal<=67108864);
   let declaredOffset=0;
   for(const input of file.parts){const piece=object(input,['name','offsetBytes','bytes','sha256']);require(typeof piece.name==='string'&&/^current_file_\d{4}_part_\d{4}\.txt$/.test(piece.name)&&!declared.has(piece.name)&&piece.offsetBytes===declaredOffset&&integer(piece.bytes,1,4194304)&&typeof piece.sha256==='string'&&hash.test(piece.sha256));declaredOffset+=piece.bytes;declared.add(piece.name);require(declaredOffset<=file.encodedBytes&&declared.size<=1024);}
   require(declaredOffset===file.encodedBytes);
   if(wanted&&!wanted.has(file.name))continue;
   selectedEncoded+=file.encodedBytes;
   const encoded=new Uint8Array(file.encodedBytes);let offset=0;
   try{
    for(const input of file.parts){
     require(!signal.aborted);const piece=object(input,['name','offsetBytes','bytes','sha256']);require(typeof piece.name==='string'&&!used.has(piece.name)&&piece.offsetBytes===offset&&integer(piece.bytes,1,4194304)&&typeof piece.sha256==='string'&&hash.test(piece.sha256));
     const bytes=physical.get(piece.name);require(bytes&&bytes.length===piece.bytes&&offset+bytes.length<=encoded.length&&await digest(bytes)===piece.sha256);decoder.decode(bytes);encoded.set(bytes,offset);offset+=bytes.length;used.add(piece.name);
    }
    require(offset===encoded.length&&await digest(encoded)===file.encodedSha256&&!signal.aborted);
    const text=decoder.decode(encoded);let bytes:Uint8Array;
    if(file.encoding==='base64'){
     require(text.length===file.encodedBytes&&text.length===4*Math.ceil(file.bytes/3)&&!/[^A-Za-z0-9+/=]/.test(text));
     const raw=atob(text);bytes=Uint8Array.from(raw,char=>char.charCodeAt(0));
     // Canonical unused bits as well as padding must round-trip exactly.
     require(btoa(raw)===text);
    }else bytes=new Uint8Array(encoded);
    if(bytes.length!==file.bytes||await digest(bytes)!==file.sha256||signal.aborted){bytes.fill(0);throw Error();}
    output.push({name:file.name,contentType:file.contentType as string,bytes});
   }finally{encoded.fill(0);}
  }
  require((!wanted||[...wanted].every(name=>names.has(name)))&&used.size===physical.size&&encodedTotal===root.totalEncodedBytes&&decodedTotal===root.totalDecodedBytes&&supplied===selectedEncoded&&encodedTotal+encoder.encode(manifest).length<=67108864&&!signal.aborted);
  return Object.freeze(output.map(file=>Object.freeze(file)));
 }catch{for(const file of output)file.bytes.fill(0);throw Error('CURRENT_SOURCE_LOGICAL_FILES_REVIEW_REQUIRED');}
}
