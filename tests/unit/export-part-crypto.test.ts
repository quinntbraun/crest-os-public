import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {FlattenedEncrypt,flattenedDecrypt} from 'jose';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createExportPartCodec,parseExportPartBinding,exportPartObjectKey,ExportPartError,maximumExportPartBytes,maximumEncryptedExportPartBytes} from '../../src/security/export-part-crypto.ts';
import type {ExportPartBinding,EncryptedExportPart} from '../../src/security/export-part-crypto.ts';

const binding:ExportPartBinding={businessId:randomUUID(),actorId:randomUUID(),exportJobId:randomUUID(),generationId:randomUUID(),recoveryEpoch:randomUUID(),partId:randomUUID(),fileName:'customers.csv',contentType:'text/csv; charset=utf-8'};
const source=Buffer.from('"private é 😀","9007199254740993","\\N"\r\n'),signal=()=>new AbortController().signal,sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const additional=(b=binding)=>Buffer.from(JSON.stringify(['crest.export-part.v1',b.businessId,b.actorId,b.exportJobId,b.generationId,b.recoveryEpoch,b.partId,b.fileName,b.contentType]));
const fixture=async()=>{const key=randomBytes(32);return {key,codec:await createExportPartCodec('export1',[{id:'export1',key}])};};
async function denied(p:Promise<unknown>){const error=await p.then(()=>null,e=>e);expect(error).toBeInstanceOf(ExportPartError);expect(error.message).toBe('EXPORT_PART_REVIEW_REQUIRED');expect(error).not.toHaveProperty('cause');}
function rewrite(record:EncryptedExportPart,change:(j:Record<string,unknown>)=>void){const value=JSON.parse(Buffer.from(record.ciphertext).toString());change(value);return {...record,ciphertext:Buffer.from(JSON.stringify(value))};}
async function independent(key:Uint8Array,payload:unknown,options:{binding?:ExportPartBinding;header?:Record<string,unknown>;payloadText?:string}={}){
 const bytes=Buffer.from(options.payloadText??JSON.stringify(payload)),jwe=await new FlattenedEncrypt(bytes).setProtectedHeader({alg:'dir',enc:'A256GCM',kid:'export1',typ:'application/vnd.crest.export-part.v1+json',...options.header}).setAdditionalAuthenticatedData(additional(options.binding)).encrypt(key);
 return {keyId:'export1',ciphertext:Buffer.from(JSON.stringify(jwe))};
}
const payload=()=>({schemaVersion:1,byteSize:source.length,sha256:sha(source),content:source.toString('base64url')});
it('uses interoperable standard JWE with random IVs, immutable binding and encrypted content/digest',async()=>{
 const {key,codec}=await fixture(),a=await codec.encrypt(source,binding,signal()),b=await codec.encrypt(source,binding,signal());
 expect(a.ciphertext).not.toEqual(b.ciphertext);const jwe=JSON.parse(Buffer.from(a.ciphertext).toString()),opened=await flattenedDecrypt(jwe,key,{keyManagementAlgorithms:['dir'],contentEncryptionAlgorithms:['A256GCM']});
 expect(opened.protectedHeader).toEqual({alg:'dir',enc:'A256GCM',kid:'export1',typ:'application/vnd.crest.export-part.v1+json'});expect(Buffer.from(opened.additionalAuthenticatedData!)).toEqual(additional());expect(JSON.parse(Buffer.from(opened.plaintext).toString())).toEqual(payload());
 expect(Buffer.from(a.ciphertext).toString()).not.toContain(source.toString());expect(Buffer.from(a.ciphertext).toString()).not.toContain(sha(source));
 const privatePart=await codec.decrypt(a,binding,signal());expect(Object.keys(privatePart)).toEqual([]);expect(()=>JSON.stringify(privatePart)).toThrow(ExportPartError);expect(privatePart.forServer().bytes).toEqual(source);expect(privatePart.metadataForServer()).toEqual({binding,byteSize:source.length,sha256:sha(source)});
 const copy=privatePart.forServer().bytes;copy.fill(88);expect(privatePart.forServer().bytes).toEqual(source);privatePart.dispose();privatePart.dispose();expect(()=>privatePart.forServer()).toThrow(ExportPartError);expect(()=>privatePart.metadataForServer()).toThrow(ExportPartError);
});
it('accepts independently generated documented JWE and exact opaque bytes for each supported part type',async()=>{
 const {key,codec}=await fixture();expect((await codec.decrypt(await independent(key,payload()),binding,signal())).forServer().bytes).toEqual(source);
 for(const [fileName,contentType]of [['manifest.json','application/json'],['readme.txt','text/plain; charset=utf-8']] as const){const b={...binding,fileName,contentType},bytes=Buffer.from([0,255,127,1]);expect((await codec.decrypt(await codec.encrypt(bytes,b,signal()),b,signal())).forServer().bytes).toEqual(bytes);}
});
it.each(['businessId','actorId','exportJobId','generationId','recoveryEpoch','partId','fileName','contentType'] as const)('rejects a different %s binding',async field=>{
 const {codec}=await fixture(),record=await codec.encrypt(source,binding,signal()),other={...binding,[field]:field==='fileName'?'other.csv':field==='contentType'?'application/json':randomUUID()};
 await denied(codec.decrypt(record,other as ExportPartBinding,signal()));
});
it.each(['protected','aad','iv','ciphertext','tag'])('rejects tampered JWE %s',async field=>{
 const {codec}=await fixture(),record=await codec.encrypt(source,binding,signal());await denied(codec.decrypt(rewrite(record,j=>{const s=j[field] as string;j[field]=(s[0]==='A'?'B':'A')+s.slice(1);}),binding,signal()));
});
it('retains old keys for read and rotates new parts to the selected active key',async()=>{
 const {key,codec}=await fixture(),record=await codec.encrypt(source,binding,signal()),next=randomBytes(32),rotated=await createExportPartCodec('export2',[{id:'export1',key},{id:'export2',key:next}]);
 expect((await rotated.decrypt(record,binding,signal())).forServer().bytes).toEqual(source);expect((await rotated.encrypt(source,binding,signal())).keyId).toBe('export2');
 await denied((await createExportPartCodec('export2',[{id:'export2',key:next}])).decrypt(record,binding,signal()));await denied((await createExportPartCodec('export1',[{id:'export1',key:randomBytes(32)}])).decrypt(record,binding,signal()));
 await denied(rotated.decrypt({...record,keyId:'export2'},binding,signal()));
});
it('copies the entire key ring and input bytes/binding before asynchronous work',async()=>{
 const key=randomBytes(32),original=Buffer.from(key),configured=[{id:'export1',key}],creating=createExportPartCodec('export1',configured);key.fill(0);configured[0]!.id='changed';const codec=await creating;
 const bytes=Buffer.from(source),mutable={...binding},encrypting=codec.encrypt(bytes,mutable,signal());bytes.fill(88);mutable.businessId=randomUUID();const record=await encrypting;
 const independentReader=await createExportPartCodec('export1',[{id:'export1',key:original}]);expect((await independentReader.decrypt(record,binding,signal())).forServer().bytes).toEqual(source);
 const input={...record,ciphertext:Buffer.from(record.ciphertext)},decrypting=codec.decrypt(input,binding,signal());input.ciphertext.fill(0);input.keyId='changed';expect((await decrypting).forServer().bytes).toEqual(source);
});
it.each(['schema','size','hash','content','extra','noncanonical-content','duplicate-payload','malformed-unicode','extra-header','algorithm','type'])('rejects authentic but unsupported or internally invalid %s',async issue=>{
 const {key,codec}=await fixture(),p:Record<string,unknown>=payload(),options:Parameters<typeof independent>[2]={};
 if(issue==='schema')p.schemaVersion=2;if(issue==='size')p.byteSize=source.length+1;if(issue==='hash')p.sha256='0'.repeat(64);if(issue==='content')p.content='AA';if(issue==='extra')p.private='unused';if(issue==='noncanonical-content')p.content=source.toString('base64url')+'=';
 if(issue==='duplicate-payload')options.payloadText=JSON.stringify(p).replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1');
 if(issue==='malformed-unicode')options.payloadText='{invalid';
 if(issue==='extra-header')options.header={extra:'unused'};if(issue==='algorithm')options.header={alg:'dir',enc:'A256GCM',kid:'different'};if(issue==='type')options.header={typ:'application/vnd.crest.provider-tokens.v1+json'};
 await denied(codec.decrypt(await independent(key,p,options),binding,signal()));
});
it('rejects forged AAD even when its unauthenticated text matches the new expectation',async()=>{
 const {codec}=await fixture(),record=await codec.encrypt(source,binding,signal()),other={...binding,generationId:randomUUID()};
 await denied(codec.decrypt(rewrite(record,j=>{j.aad=additional(other).toString('base64url');}),other,signal()));
});
it.each(['missing-field','extra-field','bad-key','empty','oversized','array','noncanonical-json'])('rejects malformed encrypted record %s',async issue=>{
 const {codec}=await fixture(),record=await codec.encrypt(source,binding,signal());let altered:unknown=record;
 if(issue==='missing-field')altered={ciphertext:record.ciphertext};if(issue==='extra-field')altered={...record,secret:'unused'};if(issue==='bad-key')altered={...record,keyId:'../key'};if(issue==='empty')altered={...record,ciphertext:new Uint8Array()};if(issue==='oversized')altered={...record,ciphertext:new Uint8Array(maximumEncryptedExportPartBytes+1)};if(issue==='array')altered=[];
 if(issue==='noncanonical-json')altered={...record,ciphertext:Buffer.from(' '+Buffer.from(record.ciphertext).toString())};
 await denied(codec.decrypt(altered as EncryptedExportPart,binding,signal()));
});
it('never releases encryption/decryption results after external cancellation',async()=>{
 const {codec}=await fixture(),aborted=new AbortController();aborted.abort();await denied(codec.encrypt(source,binding,aborted.signal));
 const record=await codec.encrypt(source,binding,signal());await denied(codec.decrypt(record,binding,aborted.signal));
 const c=new AbortController(),encrypting=codec.encrypt(source,binding,c.signal);c.abort();await denied(encrypting);
 const d=new AbortController(),decrypting=codec.decrypt(record,binding,d.signal);d.abort();await denied(decrypting);
});
it('accepts the explicit maximum without truncation and rejects empty or over-limit source bytes',async()=>{
 const {codec}=await fixture(),bytes=randomBytes(maximumExportPartBytes),record=await codec.encrypt(bytes,binding,signal());expect(record.ciphertext.byteLength).toBeLessThanOrEqual(maximumEncryptedExportPartBytes);
 const part=await codec.decrypt(record,binding,signal());expect(part.metadataForServer().sha256).toBe(sha(bytes));const actual=part.forServer().bytes;expect(actual.length).toBe(bytes.length);expect(sha(actual)).toBe(sha(bytes));part.dispose();
 await denied(codec.encrypt(new Uint8Array(),binding,signal()));await denied(codec.encrypt(new Uint8Array(maximumExportPartBytes+1),binding,signal()));
});
it.each(['../customers.csv','Customers.csv','customers.html','customers/csv','customers.csv.exe','customersXcsv','customers.csv\n'])('rejects unsafe filename %s',fileName=>expect(()=>parseExportPartBinding({...binding,fileName})).toThrow(ExportPartError));
it('pins exact binding fields and an opaque stable object namespace without a bearer URL',()=>{
 const parsed=parseExportPartBinding(binding);expect(Object.isFrozen(parsed)).toBe(true);expect(exportPartObjectKey(parsed)).toBe(`exports/${binding.businessId}/${binding.exportJobId}/${binding.generationId}/${binding.partId}.jwe`);
 for(const invalid of [{...binding,businessId:'BAD'},{...binding,secret:'unused'},{...binding,contentType:'text/html'},null,[]])expect(()=>parseExportPartBinding(invalid)).toThrow(ExportPartError);
});
it.each(['missing-active','duplicate','short-key','unknown-field','bad-id','empty-ring'])('rejects invalid key configuration %s',async issue=>{
 const key=randomBytes(32),configured:unknown=issue==='empty-ring'?[]:issue==='duplicate'?[{id:'export1',key},{id:'export1',key}]:[{id:issue==='bad-id'?'../key':'export1',key:issue==='short-key'?randomBytes(31):key,...(issue==='unknown-field'?{secret:'unused'}:{})}];
 await denied(createExportPartCodec(issue==='missing-active'?'absent':'export1',configured as {id:string;key:Uint8Array}[]));
});
