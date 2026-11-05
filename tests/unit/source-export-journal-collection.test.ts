import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {collectJournalSources,journalCollectionContext} from '../../src/security/source-export-journal-collection.ts';
import {journalCollectionFixture} from '../support/journal-collection-fixture.ts';
const check=()=>{},error='JOURNAL_SOURCE_COLLECTION_REVIEW_REQUIRED';
it('collects every fixed family including empty pages and preserves original wire JSON exactly',async()=>{
 const f=journalCollectionFixture(),query=vi.fn(f.query),out=await collectJournalSources(query,check,f.input()),journal=JSON.parse(out.journal);
 expect(Object.keys(journal.pages)).toEqual(['job','attempt','snapshot','intent','verification','completion']);expect(journal.pages.snapshot).toEqual([JSON.stringify([f.page()])]);
 expect(journal.originals[0].chunks).toEqual([' '+JSON.stringify(f.chunks[0])+'\n']);expect(journal.context).toBe(JSON.stringify(f.context));expect(out.originalBytes).toBe(Buffer.byteLength(f.text));expect(out.recordCount).toBe(1);expect(out.serializedBytes).toBe(Buffer.byteLength(out.journal));
 expect(journal).toMatchObject({assurance:'snapshot_bytes_only',sourceSchemaVersion:43,completePortableExport:false,completeBackup:false});expect(query.mock.calls.filter(([sql])=>sql.includes('_page('))).toHaveLength(6);expect(Object.isFrozen(out)).toBe(true);
});
it('collects a maximum12MiB completion with24chunks while metadata remains bounded separately',async()=>{
 const f=journalCollectionFixture(undefined,undefined,' '.repeat(12582911)+'x','completion'),out=await collectJournalSources(f.query,check,f.input()),journal=JSON.parse(out.journal);
 expect(out.originalBytes).toBe(12582912);expect(journal.originals[0].chunks).toHaveLength(24);expect(out.metadataBytes).toBeLessThan(8192);expect(out.wireBytes).toBeLessThan(25165824);expect(journal.pages.completion[0]).toContain('9007199254740993');
});
it.each(['business','time','token','extra','numeric-count','over-records','over-bytes','missing-kind','duplicate-key','unsafe-number'])('refuses context %s before any source query',async issue=>{
 const f=journalCollectionFixture(),c:Record<string,unknown>=f.context;
 if(issue==='business')c.businessId=f.recordKey;if(issue==='time')c.observedAt='2026-10-27T00:00:00+00:00';if(issue==='token')c.snapshotToken='invalid';if(issue==='extra')c.extra=true;
 if(issue==='numeric-count')f.context.recordCounts.snapshot=1 as unknown as string;if(issue==='over-records')f.context.recordCounts.snapshot='10001';if(issue==='over-bytes')c.originalTextBytes='16777217';if(issue==='missing-kind')delete (c.recordCounts as Record<string,unknown>).intent;
 const input=f.input();if(issue==='duplicate-key')input.rawContext=input.rawContext.replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1');if(issue==='unsafe-number')input.rawContext=input.rawContext.replace('"schemaVersion":1','"schemaVersion":9007199254740993');
 const query=vi.fn(f.query);await expect(collectJournalSources(query,check,input)).rejects.toThrow();expect(query).not.toHaveBeenCalled();
});
it.each(['record-budget','metadata-budget'])('refuses exhausted %s without a source page',async issue=>{
 const f=journalCollectionFixture(),input=f.input(),query=vi.fn(f.query);if(issue==='record-budget')input.remainingRecords=0;else input.remainingMetadataBytes=1;
 await expect(collectJournalSources(query,check,input)).rejects.toThrow(error);expect(query).not.toHaveBeenCalled();
});
it.each(['hash','unknown-column','unsafe-version','foreign-row','wrong-key','wrong-kind','descriptor-hash','missing-row','extra-row','missing-chunk','foreign-chunk','short-original','declared-bytes'])('discards the whole journal on %s',async issue=>{
 const f=journalCollectionFixture();if(issue==='unknown-column')f.row.unreviewed=true;if(issue==='unsafe-version')f.row.source_schema_version=42;if(issue==='foreign-row')f.row.business_id=f.recordKey;if(issue==='wrong-key')f.row.generation_id=f.businessId;if(issue==='wrong-kind')f.body.kind='completion';if(issue==='descriptor-hash')f.body.originalText.sha256='e'.repeat(64);if(issue==='foreign-chunk')f.chunks[0]!.businessId=f.recordKey;if(issue==='short-original')f.context.originalTextBytes='1';if(issue==='declared-bytes')f.context.originalTextBytes=String(Number(f.context.originalTextBytes)+1);
 const query=async(sql:string,args:unknown[])=>{const r=await f.query(sql,args);if(sql.includes('_page(')&&args[2]==='snapshot'){if(issue==='hash')r.rows=[{...f.page(),evidence_hash:'0'.repeat(64)}];if(issue==='missing-row')r.rows=[];if(issue==='extra-row')r.rows=[f.page(),f.page()];}if(sql.includes('_text_chunk(')&&issue==='missing-chunk')r.rows=[];return r;};
 await expect(collectJournalSources(query,check,f.input())).rejects.toThrow();
});
it('checks cancellation after a successful final source read and never releases a partial journal',async()=>{
 const f=journalCollectionFixture();let stopped=false;const query=async(sql:string,args:unknown[])=>{const r=await f.query(sql,args);if(sql.includes('_text_chunk('))stopped=true;return r;};await expect(collectJournalSources(query,()=>{if(stopped)throw Error('cancelled');},f.input())).rejects.toThrow('cancelled');
});
it('copies validated context scalars and freezes counts',()=>{const f=journalCollectionFixture(),c=journalCollectionContext(JSON.stringify(f.context),f.businessId,f.observedAt);f.context.recordCounts.snapshot='0';expect(c.recordCounts.snapshot).toBe('1');expect(Object.isFrozen(c.recordCounts)).toBe(true);});
