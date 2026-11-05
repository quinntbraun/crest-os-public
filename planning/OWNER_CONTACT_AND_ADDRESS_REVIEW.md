# Easier phone entry and live address review

2026-10-27. Owner feedback requests easier phone entry and real, location-relevant address suggestions. This changes presentation and the fictional review workspace; all source contracts, migrations, audit/accounting rules and production activation gates remain unchanged.

## Phone entry

The shared customer/lead phone field is immediately visible and optional. It uses type/inputMode/autocomplete tel, a +1 (555) 555-0123 example and readable formatting when not being edited. Country codes, extensions, international and unusual original input remain accepted according to the existing draft contract. Presentation never rewrites the raw saved value or assumes a new country code for ten digits. Empty input becomes unknown/null; phone input no longer requires the Record phone checkbox. Two existing native browser fixtures are adapted to that intentional interaction change while retaining raw-input/history checks. Email gains its native autocomplete/input-mode hint without changing its existing permissive source validation.

## Address workflow in the review

The existing AddressScreen, controller, clients and source validators are connected to parent-scoped review storage. Open a customer, choose Manage customer addresses, add an address and optionally enable live suggestions. The optional assistant component is supplied by the review entry only; normal production AddressScreen has no enabled provider or unprotected lookup endpoint.

Suggestions are debounced, cancellable and stale-query-bound. Search text is sent only after the visible Photon/Komoot disclosure is enabled. A typed city/state/ZIP can focus the query; Use my approximate location requires the owner's browser permission and rounds coordinates to two decimals before the request. No automatic GPS/IP lookup, stored location preference or scripted permission acceptance. Location denial/unavailability and provider failures leave manual entry available.

The review server uses the fixed Photon HTTPS endpoint with bounded input, response size, timeout, concurrency, daily request count and a short bounded memory cache. Results are deduplicated by address components. No caller-supplied host, retries, key, purchase, paid service or signup. Attribution stays visible. The provider is a best-effort public demo, suitable for this low-volume review, not an accepted production dependency or uptime guarantee.

Choosing a suggestion explicitly fills street/city/region/postal/country and map coordinates/source. Unit/line2 and instructions are retained. It clears verifiedAt and labels accuracy as map suggestion, not delivery verification. It never saves automatically, silently overwrites an owner record or certifies deliverability. Other addresses remain separate records under the exact selected customer. Quotes/work locations are unaffected.

## Provider research

- Photon maintainers permit reasonable project usage but provide no availability guarantees: https://github.com/komoot/photon . Location bias uses optional lat/lon: https://github.com/komoot/photon/blob/master/docs/api-v1.md . Verified a real public-example lookup and the actual browser selection/save/reopen flow with4765thAvenue/NewYorkPublicLibrary; no owner location or customer address was used.
- The public Nominatim endpoint prohibits autocomplete, so it is not used: https://operations.osmfoundation.org/policies/nominatim/ .
- Geoapify documents a free commercial tier and proximity bias but requires an account/API key; it remains a production candidate, not an enabled integration or a signup request: https://www.geoapify.com/address-autocomplete/ and https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/ . No secret/key is in source.

## Executed evidence and current limits

Full local suite5960cases/181files passed after the shared UI changes; the two additional rendered-phone cases were then renamed to the repository's .test.ts convention and both pass (nine focused phone cases total). Seven real-HTTP review checks pass, including exact customer-parent address save/history, snapshot row/history preservation, provider host/location bounds/cache/limits and unverified map semantics. Types/focused lint pass. Browser verified immediate phone input, +1 display with unchanged original12025550123 in sample storage; actual live public address search/select/save/reopen; unit7 retained and verifiedAt null. A360px phone form has no document overflow. Real physical geolocation permission was deliberately left to the owner; production native browser changes are written but not executed on this Windows host.

Before refreshing the preview, current sample records and histories were captured to ignored private.local review storage and validated with the new reader, then reloaded. This preserves saved fictional work during this update; it does not establish continuous durable storage or backup. Pending browser drafts are still transient. The older unregistered execution-admission/default-ACL finding remains isolated and unaccepted; no dependency on it was enabled.

Next: keep this preview available for owner feedback; prioritize visible workflow improvements and a supported real database-backed sample installation. Real Crest records, production provider activation and all financial use remain gated. Overall percent/hour estimates remain withdrawn pending a measured workflow inventory. No spending or owner signup is needed for this review.
