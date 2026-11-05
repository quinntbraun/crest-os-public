# Lead locations in the visible owner review

2026-10-27. Working review 07 connects the existing lead-address controller, transport, row/receipt and history contracts to the fictional preview. Lead locations appear after reported vehicles and before intake. Shared production defaults retain their existing provider behavior; the optional address-assist component is injected only by the review entry.

The review store reuses its fixed parent-scoped source adapter for lead vehicles and addresses. A location belongs to its actual lead and cannot be moved to another lead by an edit. Saving it does not create or overwrite a customer address, change intake/status, confirm a job location or authorize scheduling. Incomplete addresses remain valid; null and explicitly empty text stay distinct. Archive requires a reason; reopen preserves the earlier archive image. Exact original receipts survive later edits, and stale/altered/foreign-parent writes are refused before mutation.

Snapshot restoration checks genuine same-snapshot lead parents and complete history through the existing bounded history parsers. Old snapshots with no lead locations remain readable. Reset clears location rows/history and invalidates previous recovery epochs. This is temporary fictional memory storage with explicit development preservation, not production durability or backup acceptance.

## Address suggestions

The lead location form reuses the existing opt-in Photon/OpenStreetMap review search. Choosing a suggestion fills street/city/state/ZIP/country and source coordinates, retaining the current unit, exact-location text and instructions. Nothing auto-saves; verifiedAt stays null for a map suggestion. City/ZIP input works without owner location permission. The existing optional approximate-location action remains untouched and was not exercised. Search consent, cancellation, provider limits and manual fallback remain those already researched and tested for customer addresses. No new dependency, signup, paid service or production provider activation is added.

## Executed checks

All 21 actual HTTP preview cases pass, including three new groups covering incomplete locations, original save/replay/lookup, mixed source isolation, paginated history, nullable/empty instructions, archive/reopen reasons, version/parent/coordinate refusals, forged proofs/origins, complete restore, altered earlier images, missing parents and reset. All 98 focused lead-address controller/client/source-contract cases in four files pass. Type checking and focused lint pass. No new full native or production release acceptance is claimed.

Actual browser review searched the public New York library address, chose its live map match, saved and reopened with Unit 7 and instructions retained, edited instructions, archived with a required reason, included the archived location and reopened it. All four retained versions remain. Snapshot inspection confirms verifiedAt is null and the final instructions/unit remain unchanged by selection. The 360px document width is 345px; viewport restored. Tests built isolated assets, and all 21 cases left the running served JavaScript unchanged.

Saved fictional work was validated and preserved before the backend restart and after browser testing: five customers, one customer address, two vehicles, two leads, two sources, one vehicle report, one lead location, two vehicle links and three lead state events. No real data, owner location permission, financial event, schema change or spending was involved.

Next continue visible lead conversion and supported database-backed sample installation, with an actual remaining-workflow inventory for defensible V1 estimates. Scheduling, quotes, invoices, expenses, financial reports and Google Calendar remain ahead. Real Crest use remains gated; percentage/hour guesses remain withdrawn pending that inventory.
