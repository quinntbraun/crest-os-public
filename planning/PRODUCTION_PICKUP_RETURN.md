# Production pickup and return adoption

The production scheduling and condition-photo adapters now compose the existing pickup/return workflows with business-scoped capabilities. No custody policy, customer consent, pickup fee, mileage rule, SQL command, grant or database schema is changed or seeded.

The existing dependency chain remains explicit:

| Capability | Required controls |
| --- | --- |
| `pickupTrips` | `fieldSessions` |
| `pickupCollection` | `pickupTrips` |
| `pickupPolicy` | `pickupCollection` |
| `pickupPhotos` | `pickupPolicy`, `dropoffPhotos` and its actual private photo worker configuration |
| `pickupWork` | `pickupCollection`, `jobCompletion`, `unfulfilledCancellation` |
| `pickupRelease` | `pickupWork`, `pickupPhotos`, `operationResolution` |
| `pickupReturnFailure` | `pickupRelease` |

Trusted startup selects each existing scheduling mode from its declared production capability. Fixture flags remain test-only. The scheduling HTTP constructor independently checks every selected pickup mode against that authority; adding a handler boolean alone cannot enable production access. Directory pickup reads check their specific capability before credential/provider/database work. Saves check the matching capability and requested business; `start_pickup` additionally requires `pickupWork` rather than only generic field-session access.

Condition-photo HTTP composition supports pickup collection only with `pickupPhotos`, and return photos only with `pickupRelease`. Direct photo reservations enforce the same distinction. Both reuse the production photo worker and existing typed parent, arrival/policy/collection/job-version bindings. The isolated worker keeps only its existing publication role; no pickup reservation/publication command is moved into the web process. See [photo worker deployment](PRODUCTION_PHOTO_WORKER.md).

All actual writes still pass the existing session, origin/CSRF, admission, business/recovery authority, current job version, policy/arrival/photo/acknowledgement checks and retained original-operation reconciliation. Read/write parsers, database functions and audit history remain unchanged. A failed return is retained by its existing command rather than presented as a successful release. No customer handoff or actual vehicle movement is inferred from UI state.

Focused constructor, dependency, direct-denial and existing field-contract checks verify production composition boundaries. They do not authenticate a real owner or prove complete pickup/return use. Actual current owner policies/consent, deployed MFA/photo/decoder acceptance, physical phone capture and all release/recovery requirements remain open. The actual bundled release stays blocked and no real job or financial records were created.
