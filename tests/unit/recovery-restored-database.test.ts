import pg from 'pg';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {verifyRecoveryRestoredDatabase} from '../../src/tooling/recovery-restored-database.ts';
it('refuses copied recovery file evidence before querying a supplied database',async()=>{
 const client=new pg.Client(),query=vi.spyOn(client,'query'),end=vi.spyOn(client,'end');await expect(verifyRecoveryRestoredDatabase({prepared:{forRecoveryTools:()=>({filesVerified:true,completeBackup:false})},client,registrySource:'{}'},new AbortController().signal)).rejects.toMatchObject({message:'RECOVERY_RESTORED_DATABASE_REVIEW_REQUIRED',stage:'preflight'});expect(query).not.toHaveBeenCalled();expect(end).toHaveBeenCalled();
});
it('cancellation closes the transferred client without attempting a comparison',async()=>{
 const client=new pg.Client(),query=vi.spyOn(client,'query'),end=vi.spyOn(client,'end'),controller=new AbortController();controller.abort();await expect(verifyRecoveryRestoredDatabase({prepared:null,client,registrySource:'{}'},controller.signal)).rejects.toMatchObject({message:'RECOVERY_RESTORED_DATABASE_REVIEW_REQUIRED',stage:'preflight'});expect(query).not.toHaveBeenCalled();expect(end).toHaveBeenCalled();
});
