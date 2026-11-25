import {describe,it,expect,vi} from 'vitest';
import {createRecoveryMonitorAttempt,RecoveryMonitorError} from '../../src/tooling/recovery-monitor.ts';
const check='11111111-2222-4333-8444-555555555555',runId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',url='https://hc-ping.com/'+check,startedAt='2026-11-23T00:20:00.000Z',failedAt='2026-11-23T00:21:00.000Z',run={runId,startedAt},signal=()=>new AbortController().signal;
const ok=()=>new Response('OK',{status:200});
describe('independent backup monitor start/failure adapter',()=>{
 it('sends only bounded run/time/category data to fixed start/fail endpoints with matching run IDs',async()=>{
  const send=vi.fn<typeof fetch>(async()=>ok()),monitor=createRecoveryMonitorAttempt(url,run,send);
  expect(await monitor.start(signal())).toMatchObject({signal:'start',acknowledged:true,completeBackup:false});
  expect(await monitor.fail({failedAt,category:'verification'},signal())).toMatchObject({signal:'failure',acknowledged:true,completeBackup:false});
  expect(send.mock.calls.map(([target])=>String(target))).toEqual([url+'/start?rid='+runId,url+'/fail?rid='+runId]);
  const first=send.mock.calls[0]![1]!,last=send.mock.calls[1]![1]!;
  expect(first).toMatchObject({method:'POST',redirect:'error',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
  expect(JSON.parse(first.body as string)).toEqual({runId,at:startedAt});expect(JSON.parse(last.body as string)).toEqual({runId,at:failedAt,category:'verification'});
  expect(monitor.view()).toMatchObject({phase:'failed',startAttempted:true,failureAttempted:true,completeBackup:false});expect('success' in monitor).toBe(false);
  expect(()=>JSON.stringify(monitor)).toThrow('RECOVERY_MONITOR_REVIEW_REQUIRED');expect(JSON.stringify(monitor.view())).not.toContain(check);
 });
 it('rejects untrusted origins, provisioning slug URLs, redirects encoded in configuration and extra request fields',async()=>{
  const send=vi.fn<typeof fetch>();for(const invalid of ['http://hc-ping.com/'+check,url+'/',url+'?create=1',url+'#secret','https://hc-ping.com.evil.test/'+check,'https://u:p@hc-ping.com/'+check,'https://127.0.0.1/'+check,'https://hc-ping.com/key/slug',url+'/start',' '+url])expect(()=>createRecoveryMonitorAttempt(invalid,run,send)).toThrow(RecoveryMonitorError);
  expect(()=>createRecoveryMonitorAttempt(url,{...run,customer:'private'} as typeof run,send)).toThrow(RecoveryMonitorError);
  const monitor=createRecoveryMonitorAttempt(url,run,send);await expect(monitor.fail({failedAt,category:'vault',error:'private'} as {failedAt:string;category:'vault'},signal())).rejects.toMatchObject({stage:'request'});expect(send).not.toHaveBeenCalled();
 });
 it('never retries an uncertain start but can emit one independent failure and cannot restart after it',async()=>{
  const send=vi.fn<typeof fetch>().mockRejectedValueOnce(new Error(url+' private provider detail')).mockResolvedValueOnce(ok()),monitor=createRecoveryMonitorAttempt(url,run,send);
  await expect(monitor.start(signal())).rejects.toMatchObject({message:'RECOVERY_MONITOR_REVIEW_REQUIRED',stage:'dispatch'});expect(monitor.view().phase).toBe('start_unknown');
  await expect(monitor.start(signal())).rejects.toMatchObject({stage:'request'});expect(send).toHaveBeenCalledTimes(1);
  await monitor.fail({failedAt,category:'capture'},signal());await expect(monitor.start(signal())).rejects.toMatchObject({stage:'request'});await expect(monitor.fail({failedAt,category:'capture'},signal())).rejects.toMatchObject({stage:'request'});expect(send).toHaveBeenCalledTimes(2);
 });
 it.each(['OK (not found)','OK (rate limited)','<html>OK</html>','OK\n',''])('refuses HTTP200 ignored/malformed acknowledgments: %s',async body=>{
  const send=vi.fn<typeof fetch>(async()=>new Response(body,{status:200})),monitor=createRecoveryMonitorAttempt(url,run,send);
  await expect(monitor.start(signal())).rejects.toMatchObject({stage:'acknowledgment'});expect(monitor.view().phase).toBe('start_unknown');expect(send).toHaveBeenCalledTimes(1);
 });
 it('bounds and cancels oversized provider responses without retaining raw text',async()=>{
  let cancelled=false;const send=vi.fn<typeof fetch>(async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('x'.repeat(33)));},cancel(){cancelled=true;}}))),monitor=createRecoveryMonitorAttempt(url,run,send);
  await expect(monitor.start(signal())).rejects.toMatchObject({stage:'acknowledgment'});expect(cancelled).toBe(true);
 });
 it('refuses non200 replies and duplicate failure dispatch even when acknowledgment is lost',async()=>{
  const send=vi.fn<typeof fetch>(async()=>new Response('private error',{status:503})),monitor=createRecoveryMonitorAttempt(url,run,send);
  await expect(monitor.fail({failedAt,category:'vault'},signal())).rejects.toMatchObject({stage:'acknowledgment'});expect(monitor.view().phase).toBe('failure_unknown');
  await expect(monitor.fail({failedAt,category:'vault'},signal())).rejects.toMatchObject({stage:'request'});expect(send).toHaveBeenCalledTimes(1);
 });
 it('aborts before dispatch and refuses malformed time/category data without network calls',async()=>{
  const send=vi.fn<typeof fetch>(),monitor=createRecoveryMonitorAttempt(url,run,send),controller=new AbortController();controller.abort();
  await expect(monitor.start(controller.signal)).rejects.toMatchObject({stage:'request'});expect(monitor.view().startAttempted).toBe(false);
  for(const input of [{failedAt:'2026-11-23',category:'vault'},{failedAt:'2026-11-22T00:21:00.000Z',category:'vault'},{failedAt,category:'customer secret'}])await expect(monitor.fail(input as {failedAt:string;category:'vault'},signal())).rejects.toMatchObject({stage:'request'});expect(send).not.toHaveBeenCalled();
 });
 it('serializes competing signals and retains uncertainty when cancellation follows dispatch',async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),controller=new AbortController(),send=vi.fn<typeof fetch>(async()=>{await gate;return ok();}),monitor=createRecoveryMonitorAttempt(url,run,send);
  const first=monitor.start(controller.signal);await expect(monitor.fail({failedAt,category:'deadline'},signal())).rejects.toMatchObject({stage:'request'});controller.abort();release();await expect(first).rejects.toMatchObject({stage:'acknowledgment'});expect(monitor.view()).toMatchObject({busy:false,phase:'start_unknown'});expect(send).toHaveBeenCalledTimes(1);
 });
});
