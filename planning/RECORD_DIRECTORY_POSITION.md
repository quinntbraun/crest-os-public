# Customer and vehicle directory return

Opening a record from a long customer or vehicle list now remembers the originating control, the exact page position and any scrolling list containers. Back preserves the current search, explicitly loaded page and unsaved record draft. Desktop now exposes the same contextual Back action as phone. Navigation does not save a draft or fetch another page.

The context lives only in mounted memory. Changing the search/page clears the previous origin after any discard confirmation is accepted; private-data clearing, page hiding and disposal clear the references. If viewport dimensions change or the original control disappears, the browser reveals a connected fallback instead of applying an obsolete position. Fractional CSS-pixel edges do not cause unnecessary centering; genuinely obscured controls remain visible.

## Executed verification

Implementation source `a064943` passes type checking, full lint, production build and five focused helper tests. The complete registered workspace browser file passes **8/8**: all four existing customer/vehicle/dashboard-follow-up cases plus four new long-directory cases in Chromium and WebKit. New cases use genuine authentication, synthetic records saved through the protected API, phone and desktop widths (390 and 1440), explicit second-page navigation, retained dirty drafts, exact focus and scroll, changed-viewport fallback, accessibility/overflow checks and pagehide/bfcache private clearing. They assert zero directory requests on Back and unchanged customer, vehicle, operation and audit facts after navigation. Existing assertions, request limits and deadlines remain.

`.local/design-directory-position/proof.json` retains the frozen source identity, successful owned database cleanup, run log hash and **262 fresh hashed artifacts**, including eight new directory screenshots and their four observation files. Desktop customer and phone WebKit vehicle captures were visually reviewed. This is synthetic browser evidence, not physical iPhone, owner or installed-release acceptance. It does not resolve changed-record return contexts in other workflows or close shared audit groups S03/S13.
