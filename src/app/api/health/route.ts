export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Process liveness only. Database/provider/recovery readiness is not established.
export function GET() {
  return Response.json(
    { service: "crest-os", status: "ok" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
