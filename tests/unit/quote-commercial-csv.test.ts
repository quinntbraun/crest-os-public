import {createHash,randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {formatQuoteCommercialCsv,QuoteCommercialCsvError,quoteCommercialTables} from '../../src/commercial/quote-commercial-csv';
import type {QuoteCommercialSourceInput} from '../../src/commercial/quote-commercial-csv';
import {readCustomerCsv} from '../support/customer-fixture';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
function empty():QuoteCommercialSourceInput{
 const businessId=randomUUID(),snapshotToken='a'.repeat(64),quoteReviewSnapshotToken='b'.repeat(64),groups=Object.keys(quoteCommercialTables);
 return {businessId,snapshotToken,quoteReviewSnapshotToken,expectedCounts:Object.fromEntries(groups.map(g=>[g,'0'])) as QuoteCommercialSourceInput['expectedCounts'],rows:{commercialState:[],sends:[],acceptances:[],agreements:[],entitlements:[],entitlementVersions:[],allocations:[]},quotes:{businessId,snapshotToken:quoteReviewSnapshotToken,expectedFamilyCount:'0',expectedRevisionCount:'0',expectedItemCount:'0',expectedAssessmentCount:'0',expectedApprovalCount:'0',families:[],revisions:[],items:[],assessments:[],approvals:[]},references:{leads:[],leadEvents:[],conversions:[],conversionLinks:[]},historyEvidence:JSON.stringify({formatVersion:1,assurance:'snapshot_bytes_only',generationId:randomUUID(),context:{schemaVersion:1,scope:'business_history',businessId,snapshotToken:'c'.repeat(64),observedAt:'2026-10-29T00:00:00+00:00',recordCounts:{operation:'0',audit_event:'0'}},evidenceBytes:0,records:[]})};
}
it('retrieves all seven header-only open-format tables with exact part hashes and separate paired domain/history manifests',()=>{
 const input=empty(),before=structuredClone(input),files=formatQuoteCommercialCsv(input),manifest=JSON.parse(files.manifest);
 for(const spec of Object.values(quoteCommercialTables))expect(readCustomerCsv(files.files[spec.entity+'.csv']!)).toEqual([[...spec.columns]]);
 expect(manifest.parts).toHaveLength(10);for(const part of manifest.parts){expect(part.bytes).toBe(Buffer.byteLength(files.files[part.name]!));expect(part.sha256).toBe(hash(files.files[part.name]!));}
 expect(manifest.pairedQuoteManifestSha256).toBe(hash(files.quoteFiles.manifest));expect(manifest.pairedHistoryManifestSha256).toBe(hash(files.historyFiles.manifest));expect(input).toEqual(before);expect(Object.isFrozen(files.files)).toBe(true);
});
it('never turns included source formatting or unkeyed hashes into authority, full reference closure or recoverable backup acceptance',()=>{
 const files=formatQuoteCommercialCsv(empty()),manifest=JSON.parse(files.manifest),dictionary=JSON.parse(files.files['quote_commercial_dictionary.json']!);
 expect(manifest).toMatchObject({profile:'crest.quote-commercial.sources.v1',snapshotProven:false,sourceCompletenessProven:false,referenceClosureComplete:false,completeCrestExport:false,completeBackup:false});expect(dictionary.privacy).toContain('Owner-only private');expect(dictionary.privacy).toContain('Never customer-safe sharing');expect(dictionary.decode).toContain('Keep cents');expect(JSON.parse(files.files['quote_commercial_references.json']!)).toMatchObject({leads:[],leadEvents:[],conversions:[],conversionLinks:[]});
});
it('rejects omitted declared rows, foreign paired scopes and unknown columns instead of silently dropping private source facts',()=>{
 const input=empty();for(const altered of [{...input,expectedCounts:{...input.expectedCounts,sends:'1'}},{...input,quotes:{...input.quotes,businessId:randomUUID()}},{...input,quoteReviewSnapshotToken:'d'.repeat(64)},{...input,rows:{...input.rows,unreviewed:[]}},{...input,references:{...input.references,conversions:[{id:randomUUID()}]}}])expect(()=>formatQuoteCommercialCsv(altered as QuoteCommercialSourceInput)).toThrow(QuoteCommercialCsvError);
});
