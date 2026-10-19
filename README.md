# Granted

**Delivery booking and gate control for Ajax Building Company jobsites. Custom app edition: iPhone app and mobile web, on Ajax's Azure.**

> **No approved delivery, no gate access.**

Subcontractors book each delivery ahead of time against the project's 3-week look-ahead. Fixed rules approve it, reject it, or send it to a project admin. An approved delivery gets a QR gate pass. Access Control scans it at the gate: green means admit, red means turn away, and everyone affected is told why and what to do. People join a project with its project code, and a project admin approves them and chooses their access.

There is no AI anywhere at runtime. Every decision is a coded rule with a reason code and fixed wording, and every rule has a test.

This is one of two editions built so management can choose. The other is **[GrantedPA](https://github.com/AjaxAgents/GrantedPA)** (Power Apps, SharePoint and Power Automate inside Microsoft 365). See **[docs/decision.md](docs/decision.md)** for a side-by-side comparison.

## Try it now

**Proof of concept, no install:** https://ajaxagents.github.io/Granted/. It's the full app on demo data, kept in each visitor's own browser.

## Set it up on your own Azure (one command)

Open [Azure Cloud Shell](https://shell.azure.com) (Bash) as someone with Owner on the subscription, and paste:

```bash
git clone https://github.com/AjaxAgents/Granted && bash Granted/setup/azure-setup.sh
```

Answer four questions; about 15 minutes later it prints the app's address. Everything it does, and what's left before production, is in [docs/operations.md](docs/operations.md). The illustrated set-up guide for both editions is in the [GrantedPA repository](https://github.com/AjaxAgents/GrantedPA/blob/main/START-HERE.md).

## Run it locally

You need [Node.js 22](https://nodejs.org).

```bash
npm install
npm run demo          # opens the app at http://localhost:5173 on demo data
```

The demo runs the real rules and services in the browser, with a sample project and accounts (password `Granted2026`):

| Account | Sees |
|---|---|
| alex.morgan@ajaxbuilding.com | Admin: approvals, team, gate, all deliveries, settings, maintenance mode |
| riley.alvarez@gate.example.com | Access Control: scan, expected today, gate log |
| dana.ruiz@northfield.example.com | Contractor: gate passes, booking form, my deliveries, messages |

No email is sent in the demo: codes appear on screen and every email lands in Settings → Email inbox. Settings → Demo tools moves the clock so you can try early, late and on-time arrivals.

## What's in this repository

```
packages/core       The rules. Delivery and gate rules, account and permission rules, QR encoder, site time.
                    Pure TypeScript, no dependencies. 57 tests.
packages/services   The application: accounts, projects, team, deliveries, gate, notifications, maintenance mode.
                    Every permission is checked here. Runs on the API, and in the browser for the demo. 23 flow tests.
apps/api            Azure Functions (Node 22): the API at /api and the web app at /. Sessions, validation, rate limits,
                    Azure SQL store, email, database migrate tool. 16 tests.
apps/web            The app: React for the iPhone app (Capacitor, native QR scanner, Keychain) and the mobile web page.
  apps/web/ios      The Xcode project (Info.plist permissions, privacy manifest, icon, splash).
  apps/web/public   Privacy policy, terms and support pages (drafts for legal review).
db/migrations       Azure SQL schema and the least-privilege database user.
infra               Bicep for every Azure resource, with managed identities and Key Vault.
setup               azure-setup.sh (the one-command set-up) and package-azure.sh (builds granted-azure.zip).
tools               admin-code-hash.mjs (makes the admin set-up code's hash for Key Vault).
docs                Product spec, rules, architecture, security, App Store compliance, operations, testing, decision.
.github             CI (type-check, tests, builds, audit), CodeQL, Dependabot, demo, release and Azure deploy workflows.
```

## Commands

```bash
npm test              # all 96 tests (rules, accounts, QR, site time, service flows, API)
npm run typecheck     # strict TypeScript across every package
npm run demo          # the app on demo data
npm run dev -w apps/api                                    # local API with demo data on :7071
VITE_API_BASE=http://localhost:7071/api npm run dev -w apps/web   # the app against that API
npm run build         # API bundle (apps/api/dist) and web app (apps/web/dist)
```

iPhone app (on a Mac with Xcode): `cd apps/web && npm run ios:sync && npm run ios:open`. See [docs/operations.md](docs/operations.md#4-iphone-app).

## Status

| Part | State |
|---|---|
| Rules, accounts, permissions, maintenance mode | Done and tested |
| App screens (all three roles, sign-up, sign-in, reset, settings, account deletion) | Done; tested end to end in a browser |
| API | Done and tested in memory; Azure SQL store and email written to the documented APIs, to be run against the Azure resources |
| Azure infrastructure (Bicep) and one-command set-up | Written, compiles and lint-checked; the app package is tested end to end locally. Not yet run against a live Azure subscription |
| iPhone app | Xcode project generated and configured; needs a Mac, Ajax's Apple Developer account, then TestFlight |
| Legal pages | Drafts for Ajax counsel |
| Microsoft Entra External ID sign-in | API side done (token check, profile set-up); app sign-in screens to be connected once the tenant exists |

## Security in one paragraph

Passwords are hashed (PBKDF2-SHA256, 600,000 rounds), sign-in locks after 5 failures, email is confirmed by code, sessions end on password change, every API call checks the caller's access on that project, other companies' bookings are visible only as anonymous capacity, the gate log and audit log are append-only in the database, secrets live in Key Vault and are reached with managed identities, and the admin set-up code exists only as a salted hash in Key Vault. Details: [docs/security.md](docs/security.md). Report a problem: [SECURITY.md](SECURITY.md).

This repository contains no secrets and no real personal data. It is public at the owner's choice; see the note in [docs/security.md](docs/security.md#repository).

Copyright © Ajax Building Company. All rights reserved. See [LICENSE](LICENSE).
