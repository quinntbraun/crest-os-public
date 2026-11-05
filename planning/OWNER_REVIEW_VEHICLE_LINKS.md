# Customer and vehicle links in the visible review

2026-10-27. Working review 04 connects the existing vehicle association editor to the fictional review storage. The customer's record now shows its current, scheduled and historical vehicles, with a direct link to open the selected vehicle. Default production pages retain their existing behavior; the related customer panel is injected only by the review entry.

The review adapter reuses the existing command, row, closure, transfer and half-open period contracts. Ownership and billing remain separate explicit selections. A transfer validates both candidate rows and its receipt before changing either side. Conflicting owner or billing periods leave records and histories unchanged. Earlier ownership, evidence, close reason and original operation receipts remain available. This slice changes no business rule, schema, registered migration, accounting entry or production activation.

Review snapshots include association rows and retained history and validate their parent records, history continuity and overlapping periods on restore. Older snapshots without association arrays remain readable. Saved fictional rows were preserved before the controlled backend restart. This remains temporary memory storage, with manual preservation during development updates; it is not durable business storage or a tested production backup.

Review HTTP tests now build into a separate temporary directory. Testing unfinished changes cannot replace the owner's current UI assets. A before/after hash check against the running preview confirmed that all eleven HTTP tests leave its served JavaScript unchanged. Explicit npm run review:build still publishes reviewed UI changes without restarting sample storage.

## Executed validation

Eleven actual HTTP cases pass, including original-save replay, changed-payload refusal, ownership/billing conflicts, independent keeper, atomic transfer, retained histories, scheduled status, conflicting-transfer rollback and snapshot restoration. Ninety-nine focused association/vehicle/customer controller tests pass. Type checking and focused lint pass. These checks supplement earlier local unit evidence; no full native or production acceptance is claimed for this checkpoint.

Browser review saved Alex's owner/billing link for the sample 4Runner, transferred it to Jordan with a reason, reopened Alex's two-version history, verified Alex's historical customer-side link and Jordan's current link, then followed Jordan's shortcut into that exact vehicle editor. Customer and vehicle pages fit a 360px viewport (345px document width); viewport restored afterward. No real records, billing transactions, owner location permission, paid service or signup were used.

Next prioritize the owner's visible workflow feedback and a supported database-backed sample installation. Scheduling, quotes, invoices, expenses, financial reports, Google Calendar and review lead conversion remain outside this sample workspace. Whole-V1 percentage and hour guesses remain withdrawn pending a measured workflow inventory.
