# Recorded income statement

The fictional Accounting workspace can report posted revenue and expenses for an inclusive range of business dates. The report uses the same ledger controls as the posted trial balance. The PostgreSQL command resolves owner authority and then reads the grouped period and control totals in one snapshot. It adds no financial writes.

The report classifies service income, recognized net tips, discounts and returns using the fixed chart of accounts. Additional revenue and contra-revenue use their account types. Expense contributions include the sign, and reversals offset original postings by their effective date. Exact cents carry through the response, subtotal calculation and CSV. Collections are represented by their journal accounts, so cash received against an issued invoice does not count as additional revenue.

The view describes the recorded-book coverage. Opening balances, verified reconciliations, a decision about book-year configuration and full cost coverage remain separate. The export includes an account breakdown, date range, time zone, source observation timestamp and coverage information.

Schema 104 registers the read-only command. The fictional report uses the existing v19 source export and introduces no new business tables. Owner preview activation still requires release verification.
