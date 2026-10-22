const deadline = Date.now() + 30_000;
let ready = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch("http://127.0.0.1:3100/api/health", { signal: AbortSignal.timeout(2_000) });
    if (response.ok && (await response.json()).service === "crest-os") { ready = true; break; }
  } catch { /* Startup retry only; never retry a business mutation. */ }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!ready) throw new Error("Container failed liveness smoke within 30 seconds");
const response = await fetch("http://127.0.0.1:3100/");
const html=await response.text(),policy=response.headers.get('content-security-policy'),nonce=/'nonce-([A-Za-z0-9+/]{43}=)'/.exec(policy??'')?.[1];
if (!response.ok || !html.includes("Setup in progress") || !nonce || !html.includes(`nonce="${nonce}"`)
  || !response.headers.get('cache-control')?.includes('no-store') || response.headers.get('cdn-cache-control')!=='no-store') throw new Error("Container shell/policy smoke failed");
const next=await fetch("http://127.0.0.1:3100/");
if(!next.ok||next.headers.get('content-security-policy')===policy)throw new Error('Container must generate a fresh document nonce');
await next.arrayBuffer();
console.log("Read-only, non-root container serves liveness and uncached nonce-protected shell");
