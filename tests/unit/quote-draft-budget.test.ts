import {randomUUID,createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {quoteDraftAuditBytes,quoteDraftAuditLimit,quoteJsonbTextBytes} from '../../src/commercial/quote-draft-budget';
import {prepareQuoteContent} from '../../src/commercial/quote-content';
import {quoteBodyLimit} from '../../src/commercial/quote-storage-contract';
import {quoteFixture} from '../support/quote-fixture';

it.each([[null,'null'],[true,'true'],[false,'false'],[1,'1'],[-12,'-12'],['雪 é 😀','"雪 é 😀"'],['quote " slash \\ tab\t newline\n','"quote \\" slash \\\\ tab\\t newline\\n"'],[[], '[]'],[{},'{}'],[[1,null,'雪'],'[1, null, "雪"]'],[{b:false,a:['é',true]},'{"a": ["é", true], "b": false}']] as const)('counts supported JSONB text bytes for %j', (value,text)=>{
 expect(quoteJsonbTextBytes(value)).toBe(new TextEncoder().encode(text).byteLength);
});
it('does not accept fractional or nonfinite numbers as supported typed projection integers',()=>{for(const value of [NaN,Infinity,1.5,1e30])expect(()=>quoteJsonbTextBytes(value)).toThrow('QUOTE_AUDIT_INTEGER_REQUIRED');});
it('counts key/value escaping and JSONB spaces independently of object insertion order',()=>{
 const a={'line\nkey':'\\N\n\t"雪😀',nested:{empty:[],nil:null}},b={nested:{nil:null,empty:[]},'line\nkey':'\\N\n\t"雪😀'};
 expect(quoteJsonbTextBytes(a)).toBe(quoteJsonbTextBytes(b));expect(quoteJsonbTextBytes(a)).toBe(new TextEncoder().encode('{"line\\nkey": "\\\\N\\n\\t\\"雪😀", "nested": {"empty": [], "nil": null}}').byteLength);
});
it('counts the actual ordinary typed revision delta including canonical text escaped as a string',()=>{
 const f=quoteFixture(),before=structuredClone(f.revision),after={...f.revision,version:'2',content_version:'2'};
 // Equal-length UUID/hash/instant placeholders cannot change scalar size.
 const expected=quoteJsonbTextBytes({schemaVersion:1,before,after});expect(quoteDraftAuditBytes(f.prepared,f.revision)).toBe(expected);expect(quoteDraftAuditBytes(f.prepared,null)).toBeLessThan(expected);expect(expected).toBeLessThan(quoteDraftAuditLimit);expect(f.revision).toEqual(before);
});
it('preserves prior provenance and counts decimal version/sequence growth, import IDs and optional metadata',()=>{
 const f=quoteFixture(),p=prepareQuoteContent({...f.input,expiryAt:'2026-10-29T21:00:00.123456Z',internalNotes:'Private 雪 \\ "\n',timezone:'Pacific/Chatham'}),base={...f.revision,version:'9',content_version:'9'},grown={...base,version:'99',content_version:'99'};
 expect(quoteDraftAuditBytes(p,grown)-quoteDraftAuditBytes(p,base)).toBe(4);
 expect(quoteDraftAuditBytes(p,{...base,import_row_id:randomUUID(),origin:'import'})-quoteDraftAuditBytes(p,base)).toBe(68);
 expect(quoteDraftAuditBytes(p,{...base,sequence:'9007199254740993'})-quoteDraftAuditBytes(p,base)).toBe(30);
 expect(quoteDraftAuditBytes(p,{...base,created_at:'1999-12-31T23:59:59.654321Z',created_by:randomUUID(),updated_at:'2026-10-28T00:00:00.999999Z',updated_by:randomUUID()})).toBe(quoteDraftAuditBytes(p,base));
});
it('distinguishes a wire/create-compatible quote from its oversized before-and-after retained edit',()=>{
 const f=quoteFixture(),content={...f.input,documentDiscount:null,lines:Array.from({length:9},()=>({...f.input.lines[0]!,id:randomUUID(),inclusions:'x'.repeat(8000)}))},prepared=prepareQuoteContent(content),previous={...f.revision,customer_safe_snapshot:prepared.customer,internal_snapshot:prepared.internal,canonical_content:prepared.canonical,content_hash:createHash('sha256').update(prepared.canonical).digest('hex'),total_cents:prepared.customer.totalCents};
 expect(new TextEncoder().encode(JSON.stringify({...f.input,...content})).byteLength).toBeLessThan(quoteBodyLimit);expect(quoteDraftAuditBytes(prepared,null)).toBeLessThan(quoteDraftAuditLimit);expect(quoteDraftAuditBytes(prepared,previous)).toBeGreaterThan(quoteDraftAuditLimit);
});
