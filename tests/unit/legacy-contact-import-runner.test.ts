import {afterEach,describe,expect,it,vi} from 'vitest';
import {startLegacyContactImportRunner} from '../../src/customer/legacy-contact-import-runner.ts';

describe('contact import runner',()=>{
 afterEach(()=>vi.useRealTimers());

 it('serializes dispatch, aborts on shutdown and lets a replacement resume',async()=>{
  vi.useFakeTimers();
  let finish!:()=>void;
  const gate=new Promise<void>(resolve=>{finish=resolve;});
  const dispatch=vi.fn(async(signal:AbortSignal)=>{
   await gate;
   expect(signal.aborted).toBe(true);
   return false;
  });
  const stop=startLegacyContactImportRunner(dispatch);
  await vi.advanceTimersByTimeAsync(25000);
  expect(dispatch).toHaveBeenCalledOnce();

  const closing=stop();
  expect(dispatch.mock.calls[0]?.[0].aborted).toBe(true);
  finish();
  await closing;
  expect(vi.getTimerCount()).toBe(0);

  const restarted=vi.fn().mockResolvedValue(true);
  const stopReplacement=startLegacyContactImportRunner(restarted);
  await vi.advanceTimersByTimeAsync(2250);
  expect(restarted).toHaveBeenCalledTimes(2);
  await stopReplacement();
  expect(vi.getTimerCount()).toBe(0);
 });

 it('backs off on database errors and resets after the next successful check',async()=>{
  vi.useFakeTimers();
  const dispatch=vi.fn().mockRejectedValueOnce(Error()).mockRejectedValueOnce(Error()).mockResolvedValue(false);
  const stop=startLegacyContactImportRunner(dispatch);
  await vi.advanceTimersByTimeAsync(7999);
  expect(dispatch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2001);
  expect(dispatch).toHaveBeenCalledTimes(4);
  await stop();
  expect(vi.getTimerCount()).toBe(0);
 });
});
