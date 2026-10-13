# Security and privacy

Granted is used by many companies, on personal phones, across many projects. The target is **OWASP ASVS 4.0 Level 2** for the API and web app and **OWASP MASVS (L1)** for the iPhone app, with an independent penetration test before go-live. Where Apple's and Microsoft's rules differ, the stricter one is followed. Each control below names the code that implements it.

## Accounts and sign-in

| Control | How | Where |
|---|---|---|
| Password storage | PBKDF2-SHA256, 600,000 iterations (OWASP 2023), 16-byte random salt per user. Older hashes are upgraded on the next sign-in. With External ID, Granted holds no passwords at all. | `services/src/crypto.ts`, `service.ts signIn` |
| Password rules | 8–128 characters with upper, lower and a number. The app shows a live checklist; the API enforces the same rules. | `core/src/accounts.ts` |
| Email confirmation | 6-digit code, 15-minute expiry, stored only as a hash, 5 wrong tries then a new code is needed. No project access until confirmed. | `service.ts issueCode/checkCode` |
| Brute force | 5 failed sign-ins in 15 minutes locks the account for 15 minutes; per-IP limits on sign-in and sign-up; limits on resend, reset and code entry. | `accounts.ts lockState`, `service.ts throttle` |
| Account enumeration | Same message and similar timing for an unknown email and a wrong password. Password reset always answers the same. | `service.ts signIn`, `startPasswordReset` |
| Sessions | Signed tokens (HS256, 32+ byte secret from Key Vault) carrying a session version. A password change or reset ends every other session at once. iPhone: token in the iOS Keychain. | `apps/api/src/auth.ts`, `apps/web/src/lib/storage.ts` |
| Account deletion | In the app (Settings → Delete my account), as Apple requires. Removes profile, sign-in, access and messages. Delivery records stay for site safety and audit, with name and contact details removed. | `service.ts deleteAccount` |

## Ajax membership

- Ajax membership comes only from a **confirmed** `@ajaxbuilding.com` email, using an exact domain match (look-alikes such as `ajaxbuilding.com.evil.example` fail). It never comes from the Yes/No answer.
- With External ID, Ajax staff can sign in with their Ajax Microsoft account. That proves employment through Ajax's own directory, and access ends automatically when someone leaves Ajax.

## Project access

- **Nothing without approval.** A project code only creates a request. Access starts when an Admin of that project approves and picks the role, or when an invite bound to that exact confirmed email is used.
- **Every API call checks the caller's role on that project** against the permission table (`core/src/accounts.ts PERMISSIONS`). Hiding a button in the app is never the control.
- **Need to know.** Each project view is built for the caller's role (`service.ts projectView`):
  - Contractors see only their own company's deliveries. Other companies' bookings arrive only as anonymous capacity (gate, day, slot, zone, pallets).
  - Access Control sees today's approved list and the gate log.
  - Admins see the project.
- **Approval emails go only to that project's Admins**, never to every admin account.
- **Invites** are single use, expire after 7 days, are bound to one email, and can be revoked.
- **Project codes** identify a project but are not a password. Admin accounts can replace a code; the old one stops working at once. Code entry is rate-limited and logged.
- **At least one Admin** always remains. Admins can't demote or remove themselves. Admin changes are emailed to that project's Admins.
- **Maintenance mode** is honoured only for an Ajax admin account that is an Admin on the project. It can only narrow permissions, and everything done with it is labelled.

## The admin set-up code

Typing the admin set-up code as a project code, with a confirmed Ajax email, makes the account an Ajax admin account (able to create projects).

- **The code is not in this repository, the app, the database or any log.** The API holds only a salted PBKDF2 hash (600,000 iterations) in Key Vault (`admin-setup-code-hash`), made with `node tools/admin-code-hash.mjs`.
- It only works for a confirmed `@ajaxbuilding.com` email. Any other email gets exactly the same answer as a mistyped code.
- Tries are limited to 5 an hour per email.
- Every use is written to the audit log (`account.adminGranted`). Alert on it in Application Insights so an unexpected new admin is noticed.
- **Advice:** the code is also Ajax's master password, so Ajax may want a separate code just for Granted. A short code can be guessed from its hash, which is why only a slow salted hash is kept, and only in Key Vault. The demo build includes a code hash only if one is given at build time, and a public demo should never be given the real one. Ajax can change the code at any time by putting a new hash in Key Vault; no code change or release is needed.

## Gate passes

- Passes are 6 characters from a 25-character alphabet with no look-alike characters, made by the system's secure random generator. A pass is valid only on its day and within its arrival window.
- A pass is admitted once. The check and the "used" mark happen together under the project lock.
- Every admit and turn-away is logged with the guard and the time. The log is append-only: the app's database user has no UPDATE or DELETE on it.
- **Planned:** a signed pass (HMAC in the QR) so the gate can reject made-up codes offline. "Used" would still be recorded on the server.

## API and infrastructure

- **HTTPS only.** TLS 1.2 or later, HSTS on the web app, iOS App Transport Security with no exceptions.
- **Input validation.** Every request body is checked against a strict schema (unknown fields refused, lengths capped) before the services see it. The services then apply the business limits.
- **Responses** carry `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. CORS allows only listed origins. Errors never include stack traces.
- **Content Security Policy** on the app: only its own scripts, no inline script, no third-party fonts or scripts. Fonts are bundled.
- **SQL**: every value is a parameter, never pasted into SQL text.
- **Managed identities everywhere.** The API reaches SQL, Key Vault, Storage, Application Insights and email with its managed identity. There are no database passwords or access keys in settings. SQL allows Microsoft Entra sign-in only.
- **Least privilege in the database.** The app user can't change the schema, and it can't update or delete the gate log or audit log (`db/migrations/002_app_user.sql`).
- **Secrets**: the session secret and the admin-code hash live in Key Vault (soft delete and purge protection on). The API refuses to start in production with unsafe settings (`apps/api/src/config.ts`).
- **Audit log**: sign-ups, verification, admin grants, lockouts, approvals, role changes, removals, invites, overrides, project code changes, deletions.
- **Monitoring**: Application Insights. Suggested alerts: `account.adminGranted`, many `account.locked`, bursts of red gate results, and 5xx errors.
- **Backups**: Azure SQL point-in-time restore and geo-redundant backups.

## The iPhone app

| Control | How |
|---|---|
| Session storage | iOS Keychain (`@aparajita/capacitor-secure-storage`), never plain preferences |
| Camera | Asked for only when someone taps Scan. Plain-language reason in `NSCameraUsageDescription`. Images aren't stored or sent. |
| Scanner | Apple's Vision framework via the official `@capacitor/barcode-scanner`. No third-party analytics or advertising SDKs are in the app. |
| Privacy manifest | `ios/App/App/PrivacyInfo.xcprivacy`: no tracking; name, email, phone, user ID and user content collected for app functionality only |
| Network | HTTPS only (ATS on, no exceptions), with the API host in the Content Security Policy |
| Export compliance | `ITSAppUsesNonExemptEncryption = false` (standard HTTPS only) |

## Privacy

- Data collected is the minimum: name, work email, phone, company, project roles, delivery records and gate logs. No location, contacts or photos. No advertising and no tracking.
- The draft privacy policy, terms and support pages are in `apps/web/public` and linked from the sign-in screen, the sign-up screen and Settings. **Ajax counsel must review them before release.**
- Retention follows the project's life plus Ajax's records period (to be set by Ajax).

## Repository

- There are no secrets or real personal data in this repository. Demo accounts use `example.com` addresses, apart from one invented `@ajaxbuilding.com` demo admin needed to show the admin features.
- The repository is public at the owner's choice. Everything above is designed to stay safe even with the design published: security comes from the keys and the checks, not from secrecy. The one item that matters most is that **no real admin-code hash is ever published**; keep it in Key Vault.
- On GitHub, turn on secret scanning and push protection, branch protection on `main` with required reviews and CI, and Dependabot alerts. CodeQL and Dependabot are configured in `.github`.
- Every rule change ships with a test.
