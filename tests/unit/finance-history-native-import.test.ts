import {execFileSync} from 'node:child_process';
import {expect,it} from 'vitest';
it('loads the genuine browser fixture under normal native Node conditions',()=>{
 const output=execFileSync(process.execPath,['--input-type=module','-e',"await import('../../tests/support/source-export-browser-fixture.mjs');process.stdout.write('BROWSER_FIXTURE_NATIVE_IMPORT_OK');"],{
  cwd:new URL('.',import.meta.url),encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000,env:{...process.env,NODE_OPTIONS:''},
 });
 expect(output).toBe('BROWSER_FIXTURE_NATIVE_IMPORT_OK');
});

for(const [path,names] of [
 ['src/bookkeeping/finance-history-recording.ts',['parseFinanceAccountHistoryEvidence','parseFinanceTaxHistoryEvidence','parseMoneyChannelHistoryEvidence']],
 ['src/bookkeeping/finance-account-http.ts',['createFinanceAccountHttp']],
] as const)it('loads '+path+' in native Node without a bundler or test resolver',()=>{
 const source='const m=await import('+JSON.stringify('../../'+path)+');for(const name of '+JSON.stringify(names)+')if(typeof m[name]!=="function")throw Error("NATIVE_HISTORY_EXPORT_REQUIRED");process.stdout.write("NATIVE_HISTORY_IMPORT_OK");';
 // Anchor the evaluation module beside this test. Native ESM resolves every
 // transitive import itself; Vitest/webpack cannot supply missing suffixes.
 const output=execFileSync(process.execPath,['--conditions=react-server','--input-type=module','-e',source],{
  cwd:new URL('.',import.meta.url),encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000,env:{...process.env,NODE_OPTIONS:''},
 });
 expect(output).toBe('NATIVE_HISTORY_IMPORT_OK');
});
