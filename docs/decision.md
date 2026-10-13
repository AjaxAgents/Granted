# Choosing an edition: Granted (custom app) or GrantedPA (Power Apps)

Both editions run the same delivery and gate rules, with the same reason codes and wording, so a booking gets the same answer in either one. They differ in sign-in, the phone experience, who can use them without extra licences, and who maintains them.

- **Granted:** [github.com/AjaxAgents/Granted](https://github.com/AjaxAgents/Granted). A React app for iPhone and web, with an API and database in Ajax's Azure.
- **GrantedPA:** [github.com/AjaxAgents/GrantedPA](https://github.com/AjaxAgents/GrantedPA). A Power Apps canvas app, SharePoint lists and Power Automate flows in Ajax's Microsoft 365.

## Side by side

| | Granted (custom app) | GrantedPA (Power Apps) |
|---|---|---|
| **Sign-in** | Granted's own email and password, as designed (sign-up form, password rules, email code). Microsoft Entra External ID is an option. | Microsoft sign-in only. Subcontractors become guests in Ajax's Microsoft tenant. There's no in-app sign-up form or password rules; Microsoft's apply. |
| **Joining a project** | Project code, then admin approval or an email invite; the app handles it all | Project code in the app, but the person must already be a guest in Ajax's tenant. Invites create the guest through SharePoint sharing; Ajax IT sets up guest access once. |
| **Admin set-up code** | Yes (salted hash in Key Vault) | Yes (kept in a locked-down list that only the flow account can read) |
| **iPhone** | Its own app (Unlisted App Store link), plus mobile web | The free **Power Apps** app from the App Store, or a **wrapped** branded app. Wrapped apps are distributed only through Intune or Apple Business Manager, not the public App Store, so they suit Ajax-managed phones. |
| **Splash and login look** | Exactly as designed | The Power Apps or wrap sign-in screens; branding inside the app |
| **QR scanning** | Native camera scanner | Power Apps Barcode reader control (live camera) |
| **Push notifications** | Planned (phase 2) | Wrapped apps: general availability since April 2026 through Firebase plus a Power Automate HTTP action (a **premium** connector). Microsoft's limitations page still lists them as unsupported, so confirm in the tenant. Email and Teams work on standard licences. |
| **Separating projects and companies** | Every API call checks project and company; tested | Flows check the project on every write. Each project's lists use SharePoint item permissions (contractors see their own company's items). Admins see their own projects. |
| **Who can use it without extra cost** | Anyone | Ajax staff with Microsoft 365. Guests need a Power Apps right: either their own company's Microsoft 365 plan that includes Power Apps, or a licence Ajax assigns (Power Apps Premium is US$20 per user per month, rising to US$22 on 1 January 2027 for new terms and renewals). Gmail-type users have no home licence. |
| **Running cost** | Azure usage (small), Apple Developer US$99 a year | Inside Ajax's Microsoft 365, plus any guest licences, plus Azure Key Vault and Storage if the app is wrapped |
| **Build and change** | Code. Needs a developer or vendor for changes; CI tests every change (89 tests). | Low-code. Ajax's Power Platform makers can change screens and flows. Rule changes must be repeated in flows by hand, against the shared test cases. |
| **IT review** | New Azure resources, penetration test, App Store review | Inside existing Microsoft 365 controls (Conditional Access, MFA, DLP, retention). Guest access and DLP policy reviewed. |
| **Time to pilot** | Days once Azure and Apple accounts exist (the code is done and tested) | Two to four weeks of maker time to build the app and flows from the specs |
| **Scale** | Many projects and companies; SQL with indexes and locking | Good for a few projects. SharePoint list thresholds and flow run limits need care past roughly 5,000 deliveries a list; use one site per project. |

## A quick way to decide

**Choose GrantedPA** if:

- most subcontractor users already have Microsoft 365 through their employers, or Ajax is willing to license them;
- Ajax prefers to keep everything inside Microsoft 365 with no new Azure resources;
- Ajax's own Power Platform team will own it.

**Choose Granted** if:

- you want the experience exactly as designed: Granted's own sign-up and sign-in, an iPhone app anyone can install from a link, no Microsoft accounts or licences for subcontractors;
- the rollout will cover many projects and companies.

**Recommendation:** Granted (custom app) is the better match for the brief: an iPhone app first, self sign-up with your password rules, many outside companies, and many projects. GrantedPA is a sound choice for a smaller rollout where users already live in Microsoft 365. Either way, the rules, wording and test cases are shared, so a later switch doesn't change how deliveries are decided.

## Sources

- [Wrap overview](https://learn.microsoft.com/power-apps/maker/common/wrap/overview), [Wrap FAQ](https://learn.microsoft.com/power-apps/maker/common/wrap/faq), [Wrap limitations](https://learn.microsoft.com/power-apps/maker/common/wrap/limitations)
- [Push notifications in wrapped apps (MC1244930)](https://mc.merill.net/message/MC1244930)
- [Share a canvas app with guest users (licensing table)](https://learn.microsoft.com/power-apps/maker/canvas-apps/share-app-guests)
- [Power Apps Premium price change, January 2027](https://blog-en.topedia.com/2026/09/microsoft-increased-power-apps-premium-licensing-costs/)
- [Apple upcoming requirements](https://developer.apple.com/news/upcoming-requirements/)
