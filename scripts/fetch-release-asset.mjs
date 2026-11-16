import {setTimeout as delay} from 'node:timers/promises';

const transientStatus = new Set([408,429,500,502,503,504]);

export async function fetchReleaseAsset(url, label, timeoutMs) {
  let failure;
  for (const backoff of [0, 1_000, 3_000]) {
    if (backoff) await delay(backoff);
    let response;
    try {
      response = await fetch(url, {signal: AbortSignal.timeout(timeoutMs)});
      if (response.ok) return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (!(error instanceof TypeError) && error?.name !== 'TimeoutError') throw error;
      failure = new Error(`Tool download failed: ${label}: ${error.name}`);
      continue;
    }
    failure = new Error(`Tool download failed: ${label}: ${response.status}`);
    await response.body?.cancel().catch(() => {});
    if (!transientStatus.has(response.status)) throw failure;
  }
  throw failure;
}
