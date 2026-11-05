import 'server-only';
import {SourceExportWorkerError} from './business-source-export-worker.ts';
import type {JournalSourceExportJobPort} from './business-source-export-worker.ts';
import type {createSourceExportDatabaseJournal} from './source-export-database-journal.ts';

// Trusted composition only. Fresh credentials remain separate from the exact
// durable request JSON and are reacquired before every database stage. The
// database adapter still owns real provider/local owner/lease checks and COMMIT.
export function bindSourceExportJournalWorker(journal:ReturnType<typeof createSourceExportDatabaseJournal>,credential:(signal:AbortSignal)=>Promise<string>):JournalSourceExportJobPort{
 if(!journal||typeof credential!=='function')throw new SourceExportWorkerError();
 const stages=['authorize','snapshot','intent','verified','ready'] as const;
 const methods=stages.map(stage=>{
  if(typeof journal[stage]!=='function')throw new SourceExportWorkerError();const invoke=journal[stage].bind(journal);
  return [stage,async(request:unknown,signal:AbortSignal)=>{
   try{
    if(signal.aborted)throw new SourceExportWorkerError();const original=JSON.stringify(request),secret=await credential(signal);
    if(signal.aborted||typeof secret!=='string'||secret.length===0)throw new SourceExportWorkerError();return await invoke(secret,original,signal);
   }catch{throw new SourceExportWorkerError();}
  }];
 });
 return Object.freeze(Object.fromEntries(methods)) as JournalSourceExportJobPort;
}
