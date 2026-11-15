# Statement match review

Schema 106 adds a read-only review of ordinary bank or wallet statement allocations. The owner opens a retained fictional statement and selects posted movements from the same account. The command checks current owner authority and reads the retained rows, already posted ledger controls and eligible movements in one database snapshot. Search defaults to the statement start. It can include earlier movements for outstanding items. A large search asks for a narrower start date.

The review checks signed integer cents. A row can split across movements and a movement can split across rows. Duplicate allocations, mismatched signs, other accounts, missing movements, movements dated after the statement row, and over-allocation are refused. Existing files continue to use the v20 finance ZIP because the review adds no persisted business records.

Proposed allocations exist only while the review is open. Approval still needs canonical statement transaction identities, durable allocation and clearance records, continuity, timing evidence, supported provider netting, and a recheck under the finance lock. A fully allocated review does not approve the statement, lock the period or write journal entries.
