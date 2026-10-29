# Owner expense construction

This branch adds manual paid-expense entry, corrections, voids, retained history and an accountant CSV handoff over registered45. It is an unregistered, disabled construction, awaiting the native integration owner's migration and recovery adoption. No real business records, provider accounts or payment movements were used.

## Scope reconciliation

The owner's October28 instruction prioritizes a reliable single-owner operating tool over a sellable SaaS product. The owner then accepted invoices, manual payment tracking, expenses and income/expense reporting while a tax preparer handles formal books. This construction follows that later instruction rather than claiming completion of the earlier full-ledger plan. It is owner-entered cash bookkeeping, not certified accounting or QuickBooks feature parity. Invoices, payments and balances remain with the native integration owner; appointment proposals, Calendar preparation, follow-ups and customer duplicate review remain with the cloud owner.

This slice records positive paid expenses in USD, dated by the owner. Categories organize the records and do not determine tax deductibility. Refunds, tax accounting, mileage, bank reconciliation and a general ledger are not implemented here. Each save has a stable operation ID, a pinned recovery epoch and an expected revision. Corrections require a reason; voids preserve the preceding financial content and retain their reason. Voids cannot be silently reopened. Same-amount payments are not automatically deduplicated because separate purchases may legitimately match.

## Delivered construction

- `planning/proposals/owner-expenses.sql`: one forced-RLS immutable revision table, closed nonlogin command role, financial mutation fence, shared operation claims, retained audit images and commit-time integrity checks. The existing authentication routines are pinned before grants. Existing migrations are unchanged.
- `src/bookkeeping/expenses/`: closed domain validation, exact-cents conversion, server directory and disabled HTTP handler, safe accountant CSV plus JSON totals/escape notes.
- `src/client/expenses.ts`: private POST transport, bounded replies and session-bound edit context. History is obtained in one bounded database statement rather than mixing independently paged snapshots. Construction limit:1000 retained revisions or6MiB of history. Reaching it fails visibly, without truncating an export.
- `src/app/expenses/expense-editor.tsx`: mobile form, retained history, corrections/voids, interrupted-save lock and same-operation retry, original-operation discovery in retained history, payment-date export selection. Unsaved entries and unconfirmed saves stay in memory and warn before navigation; there is no automatic offline write queue.
- Focused unit, PostgreSQL, genuine local Auth/TOTP/restricted-login HTTP, and supplemental Chromium/WebKit component checks. The UI-only adapter is explicit and is not persistence or authentication evidence.

The CSV includes all retained revisions of expenses whose latest payment date falls in the selected period. Totals use only latest nonvoid rows. `is_current` identifies the current revision; separate `reportable_amount_cents` and `reportable_amount_usd` columns contribute zero for superseded/void rows so summing them does not double-count corrections. Original amounts remain in separate history columns. Formula-like text receives an apostrophe with a precise row/column escape map. These private downloads do not include receipt bytes or establish complete source-export/backup custody. They are an expense handoff, not a profit report. The owner must download both the CSV and accompanying notes; browsers may require allowing multiple downloads.

## Integration contract and remaining work

The native integration owner reserves the migration ordinal. This branch claims none. Do not expose the handler by toggling its flag before adoption:

1. Register the reviewed table/role/routines with source coverage, migration preflight/adoption and role ownership collectors. Extend the original-operation retirement/resolution allowlist for `bookkeeping.expense.save` without changing baseline migration bodies. Check superseded-operation handling after restored epochs.
2. Include expense revisions, their businesses/actors/memberships/operations/audit closure and any receipt attachments in complete source export and independently encrypted restore. This branch has not proved that complete recovery path.
3. Compose `createExpenseHttp` beneath the existing trusted server router with the explicit business ID, authenticated provider/token store and existing transport/CSRF/admission controls. Its `/api/business/expenses/` routes remain absent by default. No new Next page or public navigation entry is added here.
4. Mount `ExpenseEditor` with `createExpenseClient` using the existing current-session proof supplier; finish a genuine authenticated browser save/reopen/export journey against that composition. Keep the existing quote, customer, lead and service journeys.
5. Complete private receipt reservation, existing sandbox validation, immutable original/preview publication, fresh-authorized byte retrieval, source export and independent object recovery. **Receipt upload/download is unfinished.** The component says so; it does not accept a public URL, trust an object key from a browser, store binaries in PostgreSQL or pretend a filename proves custody.

The command currently verifies the financial fence at entry and completion but does not advance foreground session activity. Integrate the existing audited activity convention under a reviewed finance-specific helper before ordinary runtime exposure. Review command-result/original-operation closure during registration; a direct original lookup route is not added by this construction.

Commands for focused evidence, using an explicitly disposable loopback `crest_test` cluster and the repository's pinned Node/Supabase tools:

```text
node --conditions=react-server --test --test-concurrency=1 tests/integration/owner-expenses.test.mjs tests/integration/owner-expenses-http.test.mjs
npm exec vitest run tests/unit/expense-contract.test.ts
node --test tests/integration/owner-expenses-layout.test.mjs
npm run typecheck
```

No production readiness, real receipt custody, completed integration, or Thursday launch guarantee is asserted.
