# Granted product spec

**Granted** books every construction delivery ahead of time and controls the gate with a QR pass. One app serves three kinds of people on each project: **Contractors**, who book deliveries; **Access Control**, who scan trucks at the gate; and **Admins**, who approve people and exceptions and see everything.

- **Primary platform:** iPhone app. **Secondary:** the same app as a mobile web page.
- **Look:** Ajax royal blue (#0133A2), white and cool greys. Green and red appear only on the gate result, where they mean admit and turn away.
- **No AI at runtime.** Every decision is a fixed rule with a reason code ([business rules](business-rules.md); code in [`packages/core`](../packages/core/src)).

This repository implements everything in this document. `npm run demo` shows it.

---

## 1. Opening the app

1. **Splash:** full blue screen, white Ajax lock logo centred, "GRANTED" under it, about a second while the app restores the session.
2. **Sign in** (centred card): logo, "Sign in to Granted", **Email**, **Password** (Show/Hide), blue **Sign in** button. Below that, smaller grey links: **Forgot password?** and **New to Granted? Create an account**.
   - Wrong email or password always shows the same message, so the screen never reveals whether an email has an account.
   - 5 failed attempts in 15 minutes lock the account for 15 minutes.
   - An account whose email isn't confirmed yet goes to the code screen.

## 2. Creating an account

Fields, in order:

| Field | Rule |
|---|---|
| First name, Last name | Required |
| Phone number | 10-digit US number, saved as 214-555-0141 |
| Email | Valid address; one account per email |
| Password | At least 8 characters with one uppercase letter, one lowercase letter and one number. A live checklist ticks each rule as it's met. |
| Company name | The company the person represents |
| Member of Ajax Building Company? (Yes / No) | Checked against the email. Yes with a non-Ajax email, or No with an `@ajaxbuilding.com` email, shows a short note that the person confirms to continue. **Ajax membership always comes from the confirmed email, never from the answer.** |
| Project code (optional) | See §3. Not needed to create an account, but nothing on a project works without one. |

After **Create account**, a 6-digit code goes to the email. The account works only after the code is entered (15-minute expiry, "Send a new code" link).

## 3. Project codes, approvals and invites

- Each project has one unique code (e.g. `DDC2-7HKQ`). The prefix comes from the project name, followed by four characters that can't be misread.
- **Joining:** a person enters a code at sign-up or later with the **+** on the Project tab. That creates a **join request**, and the Admins **of that project only** are emailed (never every admin account). Until an Admin approves, the person sees "Waiting for approval" and can do nothing on that project.
- **The Admin decides the access,** not the person: **Contractor**, **Access Control** or **Admin**, plus an optional trade for contractors (used by the "activity matches your trade" rule). The Admin can also decline.
- **Invites work the other way:** an Admin enters an email and an access level. The person gets an email. When they sign up or sign in with that email, the access is applied automatically, with no approval step. Invites are single use and expire after 7 days.
- **Admin set-up code:** entering the special admin code with a confirmed `@ajaxbuilding.com` email makes the account an **Admin account**, which can create projects. With any other email the code is treated as unknown and the message gives nothing away. How this is protected is covered in [security.md](security.md#the-admin-set-up-code).
- **Creating and deleting projects** is limited to Admin accounts. The creator becomes the project's first Admin. Deleting requires typing the project code, and records are kept for audit.
- **Removing people:** Admins can change anyone's access or remove them. A project always keeps at least one Admin.

## 4. Home screen

- **Header:** textured grey band with the person's **First Last** in white and their **company** smaller below. An off-grey **gear** sits top right.
- **Tabs:** thick rows that open a drop-down panel. Several can be open at once.
- **Tab 0 (everyone): Project.** Shows the project name, the person's access and the project code. It switches between the person's projects. A blue-and-white **+** adds a project code; Admin accounts get a choice between joining with a code and creating a new project.

| Contractor | Access Control | Admin |
|---|---|---|
| **Confirm Delivery:** the QR gate pass for the next approved delivery (chips to pick another) | **Receive Delivery:** QR scanner (live camera in the iPhone app), typed-code fallback, green ADMIT / red TURN AWAY with the reason and what has to happen, one tap to log | **Today:** expected, arrived, turned away, no-shows, waiting approval, members, plus today's list |
| **Schedule Delivery:** the booking form with the slot picker, zone room and the 12 automatic checks summarised in one line | **Expected Today:** today's bookings with a Check button | **Approvals:** join requests (choose access and trade) and flagged deliveries |
| **My Deliveries:** upcoming and past, expand to reschedule or cancel | **Gate Log:** today's admits and turn-aways | **Team & Invites:** invite by email, pending invites, members, change access, remove |
| **Messages:** every email about their deliveries | | **Receive Delivery**, **Schedule Delivery** and **Confirm Delivery** (Admins can book and work the gate too), **All Deliveries**, **Emergency Pass**, **Activity** (gate log and every email sent), **Project Settings** (name, time zone, code, rules, delivery days, gates, zones, company suspensions, look-ahead upload, delete) |

**Gear (Settings):** profile (name, phone, company), change password, my projects (leave), **maintenance mode** (Ajax admin accounts that are Admins on the project), privacy policy, terms and support, sign out, delete account. The demo build adds an email inbox and demo tools (clock, reset).

**Maintenance mode** (the Settings toggle): an Ajax admin account that is an Admin on the open project can view it as **Admin, Contractor or Access Control** from a bar under the header. The server applies that role to everything shown and allowed, so the view is exact, and it can only narrow what the admin may do. Anything done in maintenance mode is labelled (bookings, gate log entries, audit log).

**Company scope:** contractors see their own company's deliveries (everyone on the project who represents the same company), not other companies'. Other bookings only count toward slot and zone capacity.

## 5. Delivery rules

Unchanged from the reviewed version and covered by tests. They are now set **per project**, and Admins edit them in Project Settings:

- 48-hour notice
- gate days and hours
- slot capacity per gate
- staging zone capacity
- activity must be in the look-ahead and before its finish
- no more than 7 days before install (more needs a reason and review)
- more than 20 pallets goes to review
- same company and activity within 7 days goes to review

The gate checks are the same: the pass exists, isn't cancelled or used, the company isn't suspended, it's the right day, and the truck is inside the arrival window. Gate pass codes use the project's prefix (e.g. `DDC2-7KQX9M`).

## 6. Who is told what

Messages now go to real people on the project:

- **Contractor:** the person who booked.
- **Access Control:** everyone with that access.
- **GC:** the project's Admins.

| Event | Contractor | Access Control | Admins |
|---|---|---|---|
| Account code / password reset | the person | | |
| Join request | | | ✓ |
| Join approved, declined, removed, access changed | the person | | |
| Invite sent / accepted | invitee | | ✓ (accepted) |
| Delivery approved | ✓ pass | ✓ | |
| Needs review | ✓ | | ✓ |
| Rejected | ✓ reasons + fix | | |
| Cancelled | ✓ | ✓ do not admit | |
| Turned away at gate | ✓ reason + fix | ✓ | ✓ |
| No-show | ✓ | | ✓ |
| Emergency pass | ✓ | ✓ | ✓ |

Every notice is an email and also appears in the app (Messages for contractors, Activity for Admins). Push notifications for the same events are planned for a later phase (Apple Push Notification service through Azure Notification Hubs).

## 7. Interpretations made (confirm or correct)

| Your note | What the app does |
|---|---|
| "smaller grey Sign In link that brings the user to the Sign In page" | Read as the **Create an account** link (the login screen is already sign in) |
| "gear icon in the top right to …" (sentence cut off) | Opens **Settings** (profile, password, projects, sign out, delete account) |
| Admin tabs | As listed in §4, including Schedule Delivery and Confirm Delivery below Receive Delivery. |
| Pending invites for an existing account | Applied straight away if the account exists, otherwise when that email signs up |
| Admin code | Upgrades an Ajax account to an Admin account. It doesn't add the person to any project; they create one or join with a code. |
| Approval emails | Go only to the Admins of the project the code belongs to |
| Contractor visibility | Company-wide on each project, so two people from one subcontractor see each other's bookings |
