# Address entry design
November 17, 2026. Implements the direct-route address recommendation from the latest end-to-end audit.

The no-customer state offers an inline read-only customer search using existing authenticated customer context/list contracts. It does not fetch on mount, create records or change links. Every page uses a fresh session/context; next-page lookup refuses a changed business and replaces results rather than mixing pages. Only minimal identity/contact fields are retained in ephemeral view state.

The existing address controller remains responsible for pending saves. An original valid pending reference selects its original customer before the chooser can appear; invalid stored references retain the original blocked recovery behavior. No retry, operation retirement or reference replacement is added.

Results, entered search and archived filter clear on hidden/pagehide/persisted restore and unmount. Late responses cannot restore cleared private data. Denied/unavailable reads have a distinct message and never look like a verified empty result. Search is limited to the existing 200-codepoint contract, with ten results per page and explicit archived inclusion.

Desktop uses a bounded two-column introduction/search composition; phones place the explanation above the search and full-width record rows. Existing contextual address lists and customer history are unchanged.

The first genuine run passed all four workspace journeys. Its phone screenshot exposed excessive introduction text, so the final layout removes repetition and brings the first matching customer above phone navigation. The final four complete Chromium/WebKit workspace journeys also passed, with no failures/skips, source stability and owned database cleanup. Ten five-width captures and their hashes are retained in `.local/design-address-chooser-compact-verified/captures` and `capture-manifest.json`. The earlier run is preserved separately.

The browser review covers explicit-search-only behavior, verified empty versus refused reads, successful recovery, page-hide clearing, responsive accessibility, first-result phone reach and opening the actual address directory. Complete customer/address/audit source snapshots remain identical across lookup/open. The five new controller tests additionally cover fresh access ordering, minimal retained fields, context-bound pagination, Unicode bounds, concurrent dispatch and late results after suspension/disposal. Existing address recovery tests retain original pending-parent precedence and blocked unreadable references.

Bundled font inspection through Chromium's platform-font report identifies regular IBM Plex Sans and semibold IBM Plex Sans SmBld as custom fonts. This verifies the files, not every served application state; do not diagnose a font defect from a historical screenshot alone.

Full latest-audit delivery, exact-source release and physical-phone acceptance remain open.

Final local checks: type checking, full lint, production build and all8,942 unit tests in371 files passed. Strict tracked-source secret scanning examined35.72MB with no findings. The published predecessor2154a04d passed all19 prerequisite jobs; Foundation checks are running and no acceptance is transferred to this later local change.
