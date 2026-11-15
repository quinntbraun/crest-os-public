import { customerUuid as uuid, customerVersion as version, exactCustomerObject as exact } from '../customer/customer-contract.ts';

type Target = Readonly<{ businessId: string; destinationId: string; jobId: string; recoveryEpoch: string; generation: string }>;
type Dependencies = Readonly<{
  next: (signal: AbortSignal) => Promise<unknown>;
  dispatch: (target: Target, signal: AbortSignal) => Promise<unknown>;
}>;
const periodMs = 1500;

export function startCalendarRunner(businessId: string, { next, dispatch }: Dependencies) {
  if (!uuid(businessId)) throw Error('GOOGLE_CALENDAR_SYNTHETIC_RUNNER_CONFIGURATION_REQUIRED');
  const lifecycle = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;

  function schedule() {
    if (lifecycle.signal.aborted) return;
    timer = setTimeout(tick, periodMs);
    timer.unref();
  }

  function tick() {
    timer = undefined;
    if (lifecycle.signal.aborted) return;
    inFlight = (async () => {
      try {
        const value = await next(lifecycle.signal);
        if (lifecycle.signal.aborted || value === null) return;
        if (!exact(value, ['businessId','destinationId','jobId','recoveryEpoch','generation']) || value.businessId !== businessId ||
          !uuid(value.destinationId) || !uuid(value.jobId) || !uuid(value.recoveryEpoch) || !version(value.generation)) return;
        const { destinationId, jobId, recoveryEpoch, generation } = value;
        await dispatch({ businessId, destinationId, jobId, recoveryEpoch, generation }, lifecycle.signal);
      } catch { /* The retained outbox and lease decide whether a later tick may retry. */ }
    })().finally(() => {
      inFlight = undefined;
      schedule();
    });
  }

  schedule();
  return async () => {
    lifecycle.abort();
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    await inFlight;
  };
}
