import {randomBytes,randomUUID} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {scheduling} from '../../src/client/scheduling.ts';
import {maintenanceFollowUpOriginal} from '../../src/operations/maintenance-follow-up-contract.ts';
import type {MaintenanceFollowUpSave} from '../../src/operations/maintenance-follow-up-contract.ts';
import {schedulingOriginalFixture} from '../fixtures/scheduling-original.ts';

const proof=()=>({csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60_000});
const signal=()=>new AbortController().signal;
function privateResponse(value:unknown,status=200){
 return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'private, no-store'}});
}
afterEach(()=>vi.unstubAllGlobals());

it('validates the full due-queue cursor and refuses a differently scoped response',async()=>{
 const businessId=randomUUID(),throughAt='2026-11-11T05:00:00.000000Z';
 const scope={scopeKind:'due',scopeId:null,throughAt};
 const query={...scope,afterTaskId:null,afterDueAt:null};
 const fetcher=vi.fn<typeof fetch>(async()=>privateResponse({schemaVersion:1,businessId,...scope,entries:[],next:null}));
 vi.stubGlobal('fetch',fetcher);
 await expect(scheduling.maintenanceList(businessId,{...query,afterTaskId:randomUUID()},proof(),signal())).rejects.toMatchObject({kind:'unavailable'});
 expect(fetcher).not.toHaveBeenCalled();
 await expect(scheduling.maintenanceList(businessId,query,proof(),signal())).resolves.toMatchObject({entries:[],next:null});
 expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/business/scheduling/maintenance-list',expect.objectContaining({
  method:'POST',credentials:'same-origin',cache:'no-store'
 }));
 expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual(query);
 fetcher.mockResolvedValueOnce(privateResponse({schemaVersion:1,businessId,...scope,throughAt:'2026-11-12T05:00:00.000000Z',entries:[],next:null}));
 await expect(scheduling.maintenanceList(businessId,query,proof(),signal())).rejects.toMatchObject({kind:'unavailable'});
});

it('accepts only the original maintenance action and preserves uncertainty after a malformed acknowledgement',async()=>{
 const {original,envelope}=schedulingOriginalFixture('operations.follow_up.save');
 if(original.commandType!=='operations.follow_up.save')throw Error();
 const {operationId,recoveryEpoch,taskId,expectedVersion}=original.reference;
 const request:MaintenanceFollowUpSave={schemaVersion:1,businessId:original.businessId,operationId,recoveryEpoch,taskId,expectedVersion,
  body:{kind:'created',customerId:randomUUID(),vehicleId:null,sourceJobId:null,dueAt:'2026-11-12T14:00:00.000000Z',reason:'Fictional reminder'}};
 const recovery=maintenanceFollowUpOriginal(request);
 expect(recovery).toEqual(original);
 expect(JSON.stringify(recovery)).not.toMatch(/Fictional reminder|dueAt|customerId|vehicleId|sourceJobId/);
 const fetcher=vi.fn(async()=>privateResponse(envelope));
 vi.stubGlobal('fetch',fetcher);
 await expect(scheduling.saveMaintenance(request,proof(),signal())).resolves.toMatchObject({original,result:{state:'committed'}});
 expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/business/scheduling/maintenance-save',expect.objectContaining({method:'POST'}));
 fetcher.mockResolvedValueOnce(privateResponse({state:'conflict',reason:'version'},409));
 await expect(scheduling.saveMaintenance(request,proof(),signal())).resolves.toEqual({state:'conflict',reason:'version'});
 fetcher.mockResolvedValueOnce(privateResponse({schemaVersion:1,original:{...original,reference:{...original.reference,taskId:randomUUID()}},result:envelope.result}));
 await expect(scheduling.saveMaintenance(request,proof(),signal())).rejects.toMatchObject({kind:'unknown'});
 expect(fetcher).toHaveBeenCalledTimes(3);
});
