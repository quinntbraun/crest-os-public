import { afterEach, describe, expect, it, vi } from 'vitest';
import { startCalendarRunner } from '../../src/operations/google-calendar-runner.ts';

const id = (n: number) => '123e4567-e89b-42d3-a456-' + String(n).padStart(12, '0');
const target = { businessId: id(1), destinationId: id(2), jobId: id(3), generation: '1', recoveryEpoch: id(4) };
function deferred() {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  return { pending, finish };
}

describe('fictional Calendar timer', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('permits one dispatch in flight, then stops and drains without a pending timer', async () => {
    vi.useFakeTimers();
    const gate = deferred();
    const next = vi.fn(async () => target);
    const dispatch = vi.fn(async (_, signal: AbortSignal) => {
      await gate.pending;
      expect(signal.aborted).toBe(true);
    });
    const close = startCalendarRunner(target.businessId, { next, dispatch });
    expect(next).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10000);
    expect(next).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(target, expect.any(AbortSignal));
    const first = close(), second = close();
    expect(vi.getTimerCount()).toBe(0);
    expect(dispatch.mock.calls[0]![1].aborted).toBe(true);
    gate.finish();
    await Promise.all([first, second]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(next).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a pending discovery and ignores an acknowledgement after shutdown', async () => {
    vi.useFakeTimers();
    const gate = deferred();
    const next = vi.fn(async () => { await gate.pending; return target; });
    const dispatch = vi.fn();
    const close = startCalendarRunner(target.businessId, { next, dispatch });
    await vi.advanceTimersByTimeAsync(2000);
    const completion = close();
    gate.finish();
    await completion;
    expect(next).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores missing, cross-business, stale-shaped and failed discovery results', async () => {
    vi.useFakeTimers();
    const next = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ ...target, businessId: id(5) })
      .mockResolvedValueOnce({ ...target, generation: '0' }).mockRejectedValueOnce(Error()).mockResolvedValueOnce(target);
    const dispatch = vi.fn();
    const close = startCalendarRunner(target.businessId, { next, dispatch });
    await vi.advanceTimersByTimeAsync(7500);
    await close();
    expect(next).toHaveBeenCalledTimes(5);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(target, expect.any(AbortSignal));
    expect(vi.getTimerCount()).toBe(0);
  });
});
