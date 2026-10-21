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
if (!response.ok || !(await response.text()).includes("Setup in progress")) throw new Error("Container shell smoke failed");
console.log("Read-only, non-root container serves liveness and shell");
