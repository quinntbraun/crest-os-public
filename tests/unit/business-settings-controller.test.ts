import {randomBytes,randomUUID} from 'node:crypto';
import {beforeEach,it,expect,vi} from 'vitest';
import type {Mock} from 'vitest';
import type {businessSettings} from '../../src/client/business-settings';
import type {authentication} from '../../src/client/authentication';
import {createBusinessSettingsController} from '../../src/client/business-settings-controller';
import type {SettingsView} from '../../src/client/business-settings-controller';
import {createPendingEditStore,pendingEdit} from '../../src/client/pending-business-edit';
import {BusinessSettingsError} from '../../src/client/business-settings';
const businessId=randomUUID(),epoch=randomUUID(),tag=randomBytes(32).toString('base64url'),operationId=randomUUID();
const snapshot=()=>({context:{schemaVersion:1 as const,businessId,legalName:'Synthetic current',businessVersion:'9007199254740993',writeState:'ready' as const,recoveryEpoch:epoch},binding:tag});
const intent=()=>pendingEdit({journalSchema:1,businessId,binding:tag,command:{schemaVersion:1,operationId,recoveryEpoch:epoch,expectedVersion:'9007199254740993',legalName:'Synthetic proposed'}});
const result=()=>({state:'committed' as const,operationId,recoveryEpoch:epoch,receipt:{schemaVersion:1 as const,businessId,businessVersion:'9007199254740994',auditEventId:randomUUID()}});
let memory:Map<string,string>,storage:Storage,store:ReturnType<typeof createPendingEditStore>,api:{[K in keyof typeof businessSettings]:Mock<(typeof businessSettings)[K]>},session:Mock<typeof authentication.session>,id:Mock<()=>string>,states:SettingsView[];
const controller=()=>createBusinessSettingsController({store,api,session,id,change:view=>states.push(view)});
beforeEach(()=>{
  memory=new Map();storage={getItem:vi.fn(key=>memory.get(key)??null),setItem:vi.fn((key,value)=>{memory.set(key,value);}),removeItem:vi.fn(key=>{memory.delete(key);})} as unknown as Storage;store=createPendingEditStore(storage);
  api={settings:vi.fn<typeof businessSettings.settings>().mockResolvedValue(snapshot()),rename:vi.fn<typeof businessSettings.rename>().mockResolvedValue(result()),lookup:vi.fn<typeof businessSettings.lookup>().mockResolvedValue({state:'absent'})};session=vi.fn<typeof authentication.session>().mockResolvedValue({csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000});id=vi.fn(()=>operationId);states=[];
});
it('loads only after fresh session verification and keeps credentials out of published view/storage',async()=>{
  const c=controller();await c.load();expect(c.view()).toMatchObject({phase:'ready',draft:'Synthetic current',canSave:false,busy:false});expect(session.mock.invocationCallOrder[0]).toBeLessThan(api.settings.mock.invocationCallOrder[0]!);expect(memory.size).toBe(0);expect(JSON.stringify(c.view())).not.toContain('csrfToken');
});
it('pins one UUID/version/epoch/name in verified storage before sending and clears only after confirmed completion',async()=>{
  const c=controller();await c.load();c.edit('Synthetic proposed');api.rename.mockImplementation(async()=>{expect(store.read()).toEqual(intent());return result();});await c.save();
  expect(api.rename.mock.calls[0]!.slice(0,2)).toEqual([businessId,intent().command]);expect(id).toHaveBeenCalledTimes(1);expect(store.read()).toBe(null);expect(c.view()).toMatchObject({phase:'review',canSave:false});expect(c.view().message).toContain('Business name saved');
});
it('single flight prevents double-clicks, edits and checks while a save is in flight',async()=>{
  let release:(value:ReturnType<typeof result>)=>void=()=>{};api.rename.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));const c=controller();await c.load();c.edit('Synthetic proposed');const pending=c.save();c.edit('Injected');await c.save();await c.check();expect(api.rename).toHaveBeenCalledTimes(1);expect(api.lookup).not.toHaveBeenCalled();expect(store.read()?.command.legalName).toBe('Synthetic proposed');release(result());await pending;
});
it('storage failure prevents dispatch and leaves no false success',async()=>{
  const c=controller();await c.load();c.edit('Synthetic proposed');vi.mocked(storage.setItem).mockImplementation(()=>{throw new Error('quota');});await c.save();expect(api.rename).not.toHaveBeenCalled();expect(c.view()).toMatchObject({phase:'blocked',canSave:false});expect(c.view().message).toContain('No change was sent');
});
it('a reload discovers pending work without a write or automatic lookup; explicit absence permits only the original retry',async()=>{
  store.write(intent());const c=controller();await c.load();expect(c.view()).toMatchObject({phase:'pending',canRetry:false});expect(api.rename).not.toHaveBeenCalled();expect(api.lookup).not.toHaveBeenCalled();await c.check();expect(c.view().canRetry).toBe(true);expect(c.view().message).toContain('does not prove');
  await c.retry();expect(api.rename.mock.calls[0]!.slice(0,2)).toEqual([businessId,intent().command]);expect(id).not.toHaveBeenCalled();expect(store.read()).toBe(null);
});
it('unknown save errors retain the exact intent across controller disposal and reload',async()=>{
  api.rename.mockRejectedValue(new BusinessSettingsError('unknown'));const c=controller();await c.load();c.edit('Synthetic proposed');await c.save();expect(store.read()).toEqual(intent());expect(c.view()).toMatchObject({phase:'pending',canRetry:false});c.dispose();const next=controller();await next.load();expect(next.view().reference).toBe(operationId);expect(api.rename).toHaveBeenCalledTimes(1);
});
it('confirmed historical lookup resolves pending work even under a new sign-in or paused recovery context',async()=>{
  store.write(intent());api.settings.mockResolvedValue({...snapshot(),binding:randomBytes(32).toString('base64url'),context:{...snapshot().context,writeState:'paused',recoveryEpoch:null}});api.lookup.mockResolvedValue(result());const c=controller();await c.load();await c.check();expect(api.rename).not.toHaveBeenCalled();expect(store.read()).toBe(null);expect(c.view().message).toContain('Save reference confirmed');
});
it.each(['binding','epoch','paused'])('absence under changed %s never rebases or enables retry',async kind=>{
  store.write(intent());const s=snapshot();if(kind==='binding')s.binding=randomBytes(32).toString('base64url');if(kind==='epoch')s.context.recoveryEpoch=randomUUID();api.settings.mockResolvedValue(kind==='paused'?{...s,context:{...s.context,writeState:'paused',recoveryEpoch:null}}:s);const c=controller();await c.load();await c.check();await c.retry();expect(c.view().canRetry).toBe(false);expect(api.rename).not.toHaveBeenCalled();expect(store.read()).toEqual(intent());
});
it('retry reverifies the context again and refuses an epoch changed after an absence check',async()=>{
  store.write(intent());const c=controller();await c.load();await c.check();expect(c.view().canRetry).toBe(true);api.settings.mockResolvedValue({...snapshot(),context:{...snapshot().context,recoveryEpoch:randomUUID()}});await c.retry();expect(api.rename).not.toHaveBeenCalled();expect(store.read()).toEqual(intent());expect(c.view().message).toContain('needs review');
});
it('a different configured business never receives a pending lookup or submission',async()=>{
  store.write(intent());api.settings.mockResolvedValue({...snapshot(),context:{...snapshot().context,businessId:randomUUID()}});const c=controller();await c.load();expect(c.view().phase).toBe('blocked');await c.check();expect(api.lookup).not.toHaveBeenCalled();expect(api.rename).not.toHaveBeenCalled();expect(store.read()).toEqual(intent());
});
it('version conflicts require fresh context and explicit review of the preserved proposed name',async()=>{
  api.rename.mockResolvedValue({state:'conflict',reason:'version',currentVersion:'9007199254740994'});const c=controller();await c.load();c.edit('Synthetic proposed');await c.save();expect(c.view().phase).toBe('review');expect(store.read()).toBe(null);await c.save();expect(api.rename).toHaveBeenCalledTimes(1);
  api.settings.mockResolvedValue({...snapshot(),context:{...snapshot().context,legalName:'Other saved',businessVersion:'9007199254740994'}});await c.load();expect(c.view()).toMatchObject({phase:'ready',currentName:'Other saved',draft:'Synthetic proposed',canSave:true});expect(api.rename).toHaveBeenCalledTimes(1);
});
it('operation conflict and recovery review retain the original identity without automatic replay',async()=>{
  for(const value of ['operation','recovery']){
    memory.clear();api.rename.mockReset();if(value==='operation')api.rename.mockResolvedValue({state:'conflict',reason:'operation'});else api.rename.mockRejectedValue(new BusinessSettingsError('recovery'));
    const c=controller();await c.load();c.edit('Synthetic proposed');await c.save();expect(c.view()).toMatchObject({phase:'pending',canRetry:false});expect(store.read()).toEqual(intent());expect(api.rename).toHaveBeenCalledTimes(1);c.dispose();
  }
});
it.each(['input','not_submitted','denied'] as const)('a definite %s result clears only the first attempt, never an earlier uncertain attempt',async kind=>{
  api.rename.mockRejectedValue(new BusinessSettingsError(kind));const c=controller();await c.load();c.edit('Synthetic proposed');await c.save();expect(store.read()).toBe(null);expect(c.view().phase).toBe('review');c.dispose();
  store.write(intent());const retry=controller();await retry.load();await retry.check();await retry.retry();expect(store.read()).toEqual(intent());expect(retry.view().phase).toBe('pending');
});
it('rate rejection and failed status checks never refund, delete, or replace the original record',async()=>{
  api.rename.mockRejectedValue(new BusinessSettingsError('limited'));const c=controller();await c.load();c.edit('Synthetic proposed');await c.save();api.lookup.mockRejectedValue(new Error('offline'));await c.check();expect(store.read()).toEqual(intent());expect(c.view().canRetry).toBe(false);expect(id).toHaveBeenCalledTimes(1);
});
it('failure to clear a confirmed record never reports not-submitted or permits a new save',async()=>{
  const c=controller();await c.load();c.edit('Synthetic proposed');vi.mocked(storage.removeItem).mockImplementation(()=>{});await c.save();expect(c.view().message).toContain('Save confirmed');expect(store.read()).toEqual(intent());expect(c.view().canSave).toBe(false);expect(c.view().canRetry).toBe(false);
});
it('returning to an edited tab locks review without discarding or automatically rebasing its proposed name',async()=>{
  const c=controller();await c.load();c.edit('Synthetic proposed');c.reviewOnReturn();expect(c.view().phase).toBe('review');expect(api.settings).toHaveBeenCalledTimes(1);await c.load();expect(c.view().draft).toBe('Synthetic proposed');expect(api.rename).not.toHaveBeenCalled();
});
it('disposal cancels delivery and ignores late completion without deleting durable pending work',async()=>{
  let release:(value:ReturnType<typeof result>)=>void=()=>{};api.rename.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));const c=controller();await c.load();c.edit('Synthetic proposed');const waiting=c.save();const before=states.length;c.dispose();expect(api.rename.mock.calls[0]![3].aborted).toBe(true);release(result());await waiting;expect(states).toHaveLength(before);expect(store.read()).toEqual(intent());
});
it('invalid names and unchanged values cannot allocate IDs or create mutations',async()=>{
  const c=controller();await c.load();for(const value of ['Synthetic current','','   ','x'.repeat(201),'\ud800']){c.edit(value);await c.save();}expect(id).not.toHaveBeenCalled();expect(api.rename).not.toHaveBeenCalled();expect(memory.size).toBe(0);
});
