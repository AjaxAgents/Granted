# Apple App Store compliance

What Apple requires, and where Granted meets it. Check this list before every submission. The guideline numbers refer to the [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).

## Build requirements (checked October 2026)

| Requirement | Granted |
|---|---|
| Built with **Xcode 26** and the **iOS 26 SDK** (required since 28 April 2026) | Capacitor 8 supports Xcode 26. Build on a Mac with Xcode 26 or later. |
| Minimum deployment target iOS 13 or later (from 9 September 2026) | iOS 15.0 (Capacitor 8 default) |
| Privacy manifest, including third-party SDKs (since May 2024) | `apps/web/ios/App/App/PrivacyInfo.xcprivacy`. Capacitor and each plugin ship their own. |
| New age-rating questionnaire (since 31 January 2026) | Answer in App Store Connect. No objectionable content, no user-to-user chat, no web browsing: the lowest rating. |
| Export compliance | `ITSAppUsesNonExemptEncryption = false`: standard HTTPS only |

## Review guidelines that apply

| Guideline | What Apple asks | How Granted meets it |
|---|---|---|
| **2.1** App completeness | Reviewers must be able to use the app | Create a reviewer account on a **review project** with sample deliveries, and put the email and password in App Review notes. Note that Ajax runs the projects, so access needs an invite. |
| **2.3** Accurate metadata | Screenshots and description match the app | Use real screenshots from a TestFlight build. Describe it as a business tool for Ajax jobsites. |
| **2.5.2 / 4.7** No downloaded code | The app can't download code that changes its behaviour | All app code ships in the build. Only data comes from the API. |
| **3.2** Business | Apps for a specific business are fine. Choose a suitable distribution. | See *Distribution* below |
| **4.2** Minimum functionality | More than a repackaged website | Native camera QR scanning (Apple Vision), Keychain session storage, native splash and status bar, and a full multi-role workflow. Push notifications are planned. |
| **4.8** Login services | If an app offers third-party or social sign-in, it must also offer an equivalent privacy-focused option (such as Sign in with Apple) | **Exempt.** Granted uses its own email-and-password accounts. If Ajax staff get "Sign in with Microsoft", that is the company's own enterprise account, which the guideline also exempts. **Don't** add Google or Facebook sign-in without adding Sign in with Apple. |
| **5.1.1(i)** Privacy policy | A link in App Store Connect **and** inside the app | `privacy.html`, linked on the sign-in and sign-up screens and in Settings. **Needs Ajax counsel review.** |
| **5.1.1(ii)** Permission | Ask for consent, explain why, only when needed | Camera is asked for only when someone taps Scan, with a plain reason. No other permissions are requested. |
| **5.1.1(iii)** Data minimisation | Collect only what's needed | Name, work email, phone, company. No location, contacts or photos. |
| **5.1.1(v)** Account deletion | If the app creates accounts, it must let people delete them in the app | Settings → Delete my account. Deletes immediately; keeps delivery records anonymised (allowed, and disclosed in the privacy policy). |
| **5.1.2** Data use and sharing | No selling data or tracking without consent | No tracking, no ads, no data brokers. `NSPrivacyTracking = false`. |
| **5.1.1(iv)** Access to the app | Don't force people to grant permissions to use the app | Contractors and admins never need the camera. Gate staff can type the code instead of scanning. |
| **1.5** Developer information | A support URL and a way to contact | `support.html` plus Ajax's support email |

## App privacy label (App Store Connect → App Privacy)

| Data type | Collected | Linked to the person | Tracking | Purpose |
|---|---|---|---|---|
| Contact info: name | Yes | Yes | No | App functionality |
| Contact info: email address | Yes | Yes | No | App functionality |
| Contact info: phone number | Yes | Yes | No | App functionality |
| Identifiers: user ID | Yes | Yes | No | App functionality |
| User content: other (delivery requests) | Yes | Yes | No | App functionality |
| Diagnostics: other | Yes (server error logs) | No | No | App functionality |
| Location, contacts, photos, health, financial, browsing, purchases | **No** | | | |

Keep this table, `PrivacyInfo.xcprivacy` and `privacy.html` in step whenever data collection changes.

## Distribution

| Option | Fits when | Notes |
|---|---|---|
| **TestFlight** (pilot) | Pilot with one project | Up to 10,000 external testers by email or public link. External testers need a short beta review. Builds expire after 90 days. |
| **Unlisted App Store app** (recommended) | Subcontractors and gate staff on their own iPhones | Full App Review. Not searchable; installed from a direct link that Ajax shares, e.g. in invite emails. Request it through Apple's unlisted app form. |
| Public App Store | Ajax wants it findable | Same review. Anyone can download it, but nothing works without a project invite or code. |
| Custom app (Apple Business Manager) | Only Ajax-managed devices | Doesn't suit outside subcontractors' personal phones |

**Needed from Ajax:** an Apple Developer Program **organisation** account (US$99 a year, D-U-N-S number required), the bundle ID `com.ajaxbuilding.granted` registered, App Store Connect access for whoever submits, and the privacy policy URL published on an Ajax domain.

## The web version

The mobile web page follows the same rules: the same privacy policy and terms, HTTPS with HSTS and a strict Content Security Policy, no third-party trackers or fonts, and camera access only on tap (`Permissions-Policy: camera=(self)`).

## Sources

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Upcoming requirements (Xcode 26 / iOS 26 SDK; minimum iOS 13)](https://developer.apple.com/news/upcoming-requirements/)
- [Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [Privacy manifest files](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files)
- [Unlisted app distribution](https://developer.apple.com/support/unlisted-app-distribution/)
- [Xcode 26 requirement for Capacitor apps](https://capawesome.io/blog/xcode-26-requirement-for-capacitor-apps/)
