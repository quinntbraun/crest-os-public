# Fictional opening receivables preview

Schema 105 covers the itemized opening AR evidence in ACCOUNTING §12. It runs against the latest saved opening worksheet’s local-midnight cutover. The owner selects an exact saved customer, adds the original legacy charge and due date, records the service scope and source reference and checksum, and lists the individual pre-cutover payments and credits. The sum is calculated in exact cents and checked against the stated remaining amount. Original tax details remain explicit as unknown or source documented. The preview cannot approve tax, create invoice numbers, alter saved evidence, or post money.

Search uses the existing private customer directory and includes retained archived customers. The separate review command uses the current finance authority and recovery epoch, refuses a stale or missing worksheet, and rechecks that every customer ID belongs to the same business. Review data stays in memory and clears when the worksheet closes, leaves the page, or changes revision. Review resolves the saved worksheet and rechecks current owner authority.

The registered command runs in the fictional owner workspace. The [schedule persistence notes](OPENING_RECEIVABLES_PERSISTENCE_CANDIDATE.md) describe durable evidence, export and recovery.
