import {afterEach, expect, it, vi} from 'vitest';
import {fetchReleaseAsset} from '../../scripts/fetch-release-asset.mjs';

vi.mock('node:timers/promises', () => ({setTimeout: vi.fn().mockResolvedValue(undefined)}));
afterEach(() => vi.unstubAllGlobals());

const url = 'https://example.invalid/pinned-tool.tar.gz';

it('recovers from a gateway timeout and returns the bytes for pin verification', async () => {
  const request = vi.fn().mockResolvedValueOnce(new Response(null, {status: 504}))
    .mockResolvedValueOnce(new Response('pinned archive'));
  vi.stubGlobal('fetch', request);
  await expect(fetchReleaseAsset(url, 'tool', 500)).resolves.toEqual(Buffer.from('pinned archive'));
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls.every(([requestedUrl]) => requestedUrl === url)).toBe(true);
});

it('bounds recovery when a transfer fails after headers or returns 503', async () => {
  const failedBody = new ReadableStream({start(controller) { controller.error(new TypeError('Interrupted')); }});
  const request = vi.fn().mockResolvedValueOnce(new Response(failedBody))
    .mockResolvedValueOnce(new Response(null, {status: 503}))
    .mockResolvedValueOnce(new Response(null, {status: 503}));
  vi.stubGlobal('fetch', request);
  await expect(fetchReleaseAsset(url, 'tool', 500)).rejects.toThrow('Tool download failed: tool: 503');
  expect(request).toHaveBeenCalledTimes(3);
});

it('fails immediately for a missing or inaccessible release asset', async () => {
  const request = vi.fn().mockResolvedValue(new Response(null, {status: 404}));
  vi.stubGlobal('fetch', request);
  await expect(fetchReleaseAsset(url, 'tool', 500)).rejects.toThrow('Tool download failed: tool: 404');
  expect(request).toHaveBeenCalledTimes(1);
});
