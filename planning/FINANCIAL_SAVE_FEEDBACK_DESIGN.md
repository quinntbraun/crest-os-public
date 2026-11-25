# Confirmed financial save feedback

Accounts, fixed/category mappings, tax approvals and money channels now distinguish a verified saved outcome from ordinary status feedback. A restrained Crest gold border and tinted surface accompany the existing explicit confirmation text. The same border widths and padding remain in neutral states; confirmation does not introduce a timed toast, overlay, delayed control or animated financial total.

`useFinancialNotice` stores the message and confirmation together. Every ordinary message defaults to neutral and starting another action clears confirmation immediately. Only an acknowledged committed result, or a validated committed-operation lookup/receipt, enables confirmation. Retiring an interrupted attempt, loading history, denied access, uncertainty and private-page clearing never imply a saved business change. There are no new requests, retries, storage, commands, accounting rules or schema changes.

The notice uses the existing 160 ms control duration and disables its transition for reduced motion. Existing workflow focus remains: money-channel saving returns to the Saved channels heading; the other reviewed saves focus their status. The test inspection restores the appropriate actual focus target and viewport.

## Executed evidence

Application source is b58d7cd. Production build, types and full lint pass; later a703ae7 changes two test files only. A Git comparison confirms no application-source difference between those commits.

- `.local/design-financial-save-feedback`: the complete five original financial files finish **8/10**, with both account, fixed mapping, category and tax journeys passing. Both channel cases stop at the newly added incorrect assumption that their status should receive focus. Their confirmation assertion passes before that failure. Source remains frozen and the owned cluster is cleaned. The run retains274 PNGs, including24 confirmation captures.
- `.local/design-financial-save-channel-focus`: after correcting the inspection to require the existing Saved channels heading, both complete original channel journeys pass **2/2** on a703ae7. The follow-up also checks that a genuinely uncertain response stays neutral. Source remains frozen and the owned cluster is cleaned. The run retains72 PNGs, including6 confirmation captures.

These are separate results, not an aggregate10/10 run or a diagnosis of older unrelated authentication/tax failures. Original business assertions, commands, request limits and deadlines remain. The new inspection checks confirmation, actual focus,360/390/1440 widths, horizontal fit, reduced-motion transition removal and zero inspection business requests. Phone captures from Chromium accounts and WebKit categories were reviewed. Captures and checksums are retained in each run's `captures.json` and `proof.json`.

S11 remains partial: other workflow states, stable loading geometry and delivered/installed/physical-device acceptance still require their own evidence. This change does not accept the complete audit, the current public draft or real Crest use.
