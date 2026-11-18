import {randomBytes,randomUUID} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {authentication,AuthenticationError} from '../../src/client/authentication';
import {scheduling} from '../../src/client/scheduling';
import {createMileageController} from '../../src/client/mileage-controller';
import {createPendingSchedulingStore} from '../../src/client/pending-scheduling';
import {mobileDepartureKind} from '../../src/operations/mobile-departure-contract';
import {jobChangeFixture} from '../fixtures/job-change';
const mileageKind='operations.mileage.record';
vi.mock('../../src/client/authentication',async importOriginal=>{const actual=await importOriginal<typeof import('../../src/client/authentication')>();return {...actual,authentication:{...actual.authentication}};});
vi.mock('../../src/client/scheduling',async importOriginal=>{const actual=await importOriginal<typeof import('../../src/client/scheduling')>();return {...actual,scheduling:{...actual.scheduling}};});
afterEach(()=>vi.restoreAllMocks());
function setup(){
 const map=new Map<string,string>(),storage={getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>{map.set(key,value);},removeItem:(key:string)=>{map.delete(key);}};
 const store=createPendingSchedulingStore(storage,mileageKind),departureStore=createPendingSchedulingStore(storage,mobileDepartureKind);
 const job=jobChangeFixture(),businessId=job.q.businessId,binding=randomBytes(32).toString('base64url'),recoveryEpoch=randomUUID();
 const session=vi.spyOn(authentication,'session').mockResolvedValue({csrfToken:'synthetic-proof',expiresAt:Date.now()+60000});
 const workspace=vi.spyOn(scheduling,'workspace').mockResolvedValue({binding,jobMileageAvailable:true,context:{schemaVersion:1,businessId,operatorId:job.q.payload.operatorId,timezone:'UTC',modeVersion:job.mode,writeState:'ready',recoveryEpoch}});
 const trips=vi.spyOn(scheduling,'mileageTrips'),controller=createMileageController({jobId:'',store,departureStore,blockers:[],change:vi.fn()});
 return {controller,session,workspace,trips,store,businessId,binding,recoveryEpoch};
}
it('offers a contextual trip choice only after access and capability checks and never reads an invented trip',async()=>{
 const f=setup();await f.controller.load();expect(f.controller.view()).toMatchObject({phase:'unavailable',selectionNeeded:true,trips:[],canSave:false});expect(f.trips).not.toHaveBeenCalled();
 f.session.mockRejectedValueOnce(new AuthenticationError('denied'));await f.controller.load();expect(f.controller.view().phase).toBe('signed-out');expect(f.controller.view().selectionNeeded).toBeFalsy();
 f.workspace.mockRejectedValueOnce(Error('disabled'));await f.controller.load();expect(f.controller.view().phase).toBe('unavailable');expect(f.controller.view().selectionNeeded).toBeFalsy();
});
it('keeps original mileage recovery ahead of a missing trip selection',async()=>{
 const f=setup();f.store.write({schemaVersion:1,businessId:f.businessId,binding:f.binding,reference:{operationId:randomUUID(),recoveryEpoch:f.recoveryEpoch,legId:randomUUID(),expectedLegVersionId:randomUUID(),expectedEvidenceVersion:'0'}});
 await f.controller.load();expect(f.controller.view().phase).toBe('pending');expect(f.controller.view().selectionNeeded).toBeFalsy();expect(f.store.read()).not.toBeNull();expect(f.trips).not.toHaveBeenCalled();
});
