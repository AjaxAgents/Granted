# Business rules

These are the only decisions the system makes. They are fixed rules, not judgement, and they run the same way every time. The code is [`packages/core/src/rules.ts`](../packages/core/src/rules.ts) (the exact wording of every message is the `REASONS` table there); each rule has a test in [`packages/core/test/rules.test.ts`](../packages/core/test/rules.test.ts). The API runs them for every decision; the app runs the same file to show the checks live while someone fills in the form.

## 1. Settings

Set per project. Admins change them in Project Settings; the API validates the ranges.

| Setting | Default | Meaning |
|---|---|---|
| `minNoticeHours` | 48 | A request must be submitted at least this many hours before its slot starts. Exactly 48 hours counts. |
| `maxDaysBeforeInstall` | 7 | Material may arrive at most this many days before its look-ahead activity starts. Earlier needs a written reason and GC review. |
| `gateOpen` / `gateClose` | 06:00 / 16:00 | Gate hours, in the project's time zone (`timeZone`, default America/Chicago). The last slot must end by closing. |
| `workDays` | Mon–Sat | Days the gate takes deliveries. `blackoutDates` adds closed days. |
| `slotMinutes` | 60 | Length of a time slot. |
| Trucks per slot | Gate 1: 2, Gate 2: 1 | Per gate, in Project Settings. |
| Staging capacity | Per zone | Per zone (pallets), in Project Settings. |
| `gateToleranceMinutes` | 60 | How early or late a truck may arrive. The window never extends outside gate hours. |
| `noShowGraceMinutes` | 60 | After the slot ends plus this, an unscanned pass is a no-show. |
| `maxPalletsPerRequest` | 20 | Larger deliveries go to review. |
| `duplicateWindowDays` | 7 | Same company + same activity within this many days goes to review. |

## 2. Request checks (in this order)

Every check runs, so a rejection lists all problems at once rather than one at a time.

| # | Check | Passes when | If not | Code |
|---|---|---|---|---|
| 1 | Required information | Company, activity, gate, date, slot, zone, material, quantity > 0, unit, whole-number pallets, contact name and a 10-digit phone are all present | Reject | R01 |
| 2 | Contractor can book | Company is not suspended | Reject | R02 |
| 3 | Activity in look-ahead | Activity ID is in the project's current look-ahead | Reject | R03 |
| 4 | Activity matches trade | Activity trade = company trade (checked only when an Admin set a trade for the company) | Reject | R04 |
| 5 | 48-hour notice | Slot start ≥ now + 48 h | Reject, with next open slot | R05 |
| 6 | Gate open | Work day, not a blackout date, slot inside gate hours | Reject, with next open slot | R06 |
| 7 | Slot has room | Approved + under-review bookings in that gate/date/slot < trucks per slot | Reject, with next open slot | R07 |
| 8 | Staging zone has room | For every day from delivery until install starts, pallets already booked in the zone + this request ≤ zone capacity | Reject, with pallets left | R08 |
| 9 | Before activity finishes | Delivery date ≤ activity finish | Reject | R09 |
| 10 | Within 7 days of install | Activity start − delivery date ≤ 7 days | Over 7 with no reason: **reject** (R10). Over 7 with a reason: **review** (F01) | R10 / F01 |
| 11 | Normal size | Pallets ≤ 20 | Review | F02 |
| 12 | Not a repeat | No other approved/under-review delivery for the same company and activity within 7 days | Review | F03 |

**Outcome:** any reject → **Rejected**. Otherwise any review flag → **Needs review**. Otherwise → **Approved** (pass issued automatically).

A request being rescheduled is never counted against its own slot or zone.

### Staging days

Material occupies its zone from the delivery date through the day its activity starts (or just the delivery day if the activity has already started). This is what check 8 measures and why early deliveries fill laydown areas.

### Next open slot

For R05, R06 and R07 the system offers the first slot at the same gate that is on a work day, at least 48 hours away, and has room, searching up to 21 days ahead.

## 3. No double booking

The API evaluates and saves each request while holding an exclusive lock on the project (an application lock inside a database transaction), so two contractors racing for the last truck slot or the last pallets in a zone can never both be approved. The second one is rejected with R07 or R08 and offered the next open slot. This is tested (`S23` in `packages/services/test/flows.test.ts`). Admit at the gate uses the same lock, so a pass can only ever be used once.

## 4. Gate checks (Receive Delivery)

| Order | Check | Result | Code |
|---|---|---|---|
| 1 | Code exists in `GatePasses` | Red if not | G01 |
| 2 | Pass is not void (cancelled or rescheduled) | Red | G02 |
| 3 | Pass not already used | Red, shows when it was used | G03 |
| 4 | Company not suspended (emergency passes exempt) | Red | G07 |
| 5 | Pass is for today | Red, shows the booked day | G04 |
| 6 | Now ≥ window opens (slot start − 60 min, not before gate opens) | Red, shows when to come back | G05 |
| 7 | Now ≤ window closes (slot end + 60 min, not after gate closes) | Red | G06 |
| — | All passed | **Green: Admit** | G00 |

A red result leaves the pass unchanged, so a truck that was too early can come back inside its window.

Typed codes are forgiving: lower case, spaces and a missing prefix are all accepted (`7kqx9m` → `DDC2-7KQX9M` on a project whose code starts `DDC2`). Pass codes use only characters that cannot be confused when read aloud or typed (no 0/O, 1/I/L, 2/Z, 5/S, 8/B).

## 5. Who is told what

All messages are fixed text from the templates in `rules.ts` (`notices`). Email goes through Azure Communication Services. Every delivery message is also kept for the in-app Messages (contractor) and Activity (Admins) views. "Security" means the project's Access Control members and "GC" means **that project's Admins**.

| Event | Contractor | Security | GC |
|---|---|---|---|
| Approved (auto or by reviewer) | Email with pass code + QR attached; in-app | Email: new delivery on the list | — |
| Needs review | Email: waiting for review, with flags; in-app | — | Email with flags; Approvals tab badge |
| Rejected | Email: every reason and fix; in-app | — | — |
| Cancelled | Email confirmation; in-app | Email: do not admit | — |
| Emergency pass | Email; in-app | Email | Email: override logged against the company |
| Turned away at gate | Email with reason and what to do; in-app | Email (record) | Email |
| No-show (hourly check) | Email; in-app | — | Email |

## 6. Display status

What the apps show, derived from the request and its pass:

| Shown as | When |
|---|---|
| Approved | Request approved, pass active, window not yet over |
| Needs review | Waiting for a GC reviewer |
| Rejected | Failed a rule or rejected by a reviewer |
| Cancelled | Cancelled by the contractor (pass void) |
| Arrived | Pass used at the gate |
| No-show | Approved, never scanned, and now is past slot end + grace |
