import type {prepareVersionedQuoteContent as prepareQuoteContent} from './quote-review-content';
import type {StoredQuoteRevision} from './quote-storage-contract';

export const quoteDraftAuditLimit=262144;
export type QuoteJsonbValue=null|boolean|string|number|readonly QuoteJsonbValue[]|{readonly [key:string]:QuoteJsonbValue};
const encoder=new TextEncoder();

/** PostgreSQL17 jsonb::text length for the supported typed JSON values. JSONB
 * writes a space after each object colon and collection comma. Object ordering
 * changes no length. Only safe integer numbers occur in these projections;
 * arbitrary JSON numeric lexemes/exponents are deliberately outside this API. */
export function quoteJsonbTextBytes(value:QuoteJsonbValue):number{
 if(value===null)return 4;
 if(typeof value==='boolean')return value?4:5;
 if(typeof value==='string')return encoder.encode(JSON.stringify(value)).byteLength;
 if(typeof value==='number'){
  if(!Number.isSafeInteger(value))throw Error('QUOTE_AUDIT_INTEGER_REQUIRED');
  return encoder.encode(JSON.stringify(value)).byteLength;
 }
 if(Array.isArray(value))return 2+value.reduce((bytes,item)=>bytes+quoteJsonbTextBytes(item),0)+Math.max(0,value.length-1)*2;
 if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)throw Error('QUOTE_AUDIT_TYPED_JSON_REQUIRED');
 const entries=Object.entries(value);return 2+entries.reduce((bytes,[key,item])=>bytes+quoteJsonbTextBytes(key)+2+quoteJsonbTextBytes(item),0)+Math.max(0,entries.length-1)*2;
}

/** Current-source UI hint for the retained revision audit delta, not authority
 * or a new business limit. The database checks its actual locked before/after
 * values. Placeholders below are size-only, never records or save payloads. */
export function quoteDraftAuditBytes(prepared:Pick<ReturnType<typeof prepareQuoteContent>,'customer'|'internal'|'canonical'>,previous:StoredQuoteRevision|null):number{
 const uuid='00000000-0000-0000-0000-000000000000',stamp='2000-01-01T00:00:00.000000Z';
 const candidate:StoredQuoteRevision={...(previous??{id:uuid,business_id:uuid,family_id:uuid,sequence:'1',kind:'initial',state:'Draft',version:'1',content_version:'1',tax_readiness:'not_configured',created_at:stamp,created_by:uuid,origin:'manual',import_row_id:null}),
  state:'Draft',version:previous?(BigInt(previous.version)+1n).toString():'1',content_version:previous?(BigInt(previous.content_version)+1n).toString():'1',
  customer_safe_snapshot:prepared.customer,internal_snapshot:prepared.internal,canonical_content:prepared.canonical,content_hash:'0'.repeat(64),total_cents:prepared.customer.totalCents,expiry_at:prepared.customer.expiryAt,timezone:prepared.customer.timezone,
  updated_at:stamp,updated_by:uuid,operation_id:uuid};
 return quoteJsonbTextBytes({schemaVersion:1,before:previous,after:candidate});
}
