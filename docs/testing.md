# Testing

`npm test` runs **89 automated tests** in about 4 seconds. They run with the server's clock settings (`TZ=UTC`, rules on the site's wall clock). CI runs them on every push.

| Suite | Tests | Proves |
|---|---|---|
| `packages/core/test/rules.test.ts` | 33 | Every delivery rule and gate check (T01–T20, G-T01–G-T07, S-T01–S-T04), including boundaries such as exactly 48 hours, the window edges and arrival windows clamped to gate hours |
| `packages/core/test/accounts.test.ts` | 12 | Password rules, Ajax membership by exact domain, sign-up validation and the Yes/No note, admin code handling (an outsider and a typo get the same answer), project codes, permissions, lockout, phone format |
| `packages/core/test/qr.test.ts` | 6 | The QR encoder's output decodes with an independent reader (jsQR) for every version 1–10, UTF-8 text, PNG and SVG output |
| `packages/core/test/time.test.ts` | 6 | Site time across daylight saving, the evening when the UTC date is already tomorrow, and gate checks showing site time on a UTC server |
| `packages/services/test/flows.test.ts` | 23 | End-to-end situations: sign-up and confirmation, lockout, the admin code, password reset limits, sessions ending on password change, account deletion; join requests emailing **only that project's admins**; invites (including expired and revoked); always keeping an admin; code replacement and project deletion; booking, approval, the QR email attachment, admit once, turn-away emails, contractors seeing only their own company, **two contractors racing for the last slot**, review and approval, rescheduling and cancelling, suspension and emergency passes, no-shows, **maintenance mode** for each role, and the demo data |
| `apps/api/test/api.test.ts` | 9 | Sessions required, malformed bodies refused, errors mapped to safe messages, CORS allow-list, the maintenance header honoured only for Ajax admin accounts, password change signing out other sessions, sign-up through the API, production settings checks |

## Browser check

A scripted run with Chromium at iPhone size (390 × 844) covered:

- **Admin:** sign in, approve a join request, check a pass from Expected Today, admit, type a bad code (red), turn on maintenance mode and view as Contractor and as Access Control.
- **Contractor:** sign in and book a delivery with all 12 checks passing, which shows the gate pass with its QR.
- **New user:** sign up with a project code, confirm, and see the join request sent.

There were no console errors and no sideways scrolling.

## Not yet tested here (needs Ajax's environments)

| Item | How to test |
|---|---|
| Azure SQL store (`apps/api/src/sql-store.ts`) and the migrations | Deploy the pilot and run the post-deployment checks in [operations.md §3](operations.md#3-after-deploying-check-it-works). The SQL is syntax-checked (T-SQL parser) and the Bicep compiles. |
| Email through Communication Services | The same pilot checks: the code email, the approval email with its QR attachment |
| iPhone build, camera scanning, Keychain | TestFlight on two or three phones (iOS 15 and the latest), at the gate in daylight and at dusk |
| External ID sign-in | After Ajax IT creates the tenant |
| Load | A pilot week, then a load test of about 200 bookings an hour before rollout |
| Security | An independent penetration test against ASVS L2 before go-live |

## Pilot acceptance (two weeks, one project)

1. Every delivery that week goes through Granted. Note anything that had to bypass it.
2. Every turn-away email reaches the contractor within 5 minutes.
3. No double-booked slots and no pass admitted twice (check the gate log).
4. Gate staff can scan in under 5 seconds in daylight. Note how dusk and glare go.
5. Contractors can book in under 3 minutes without help.
