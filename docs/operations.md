# Operations: set up, release and run

Who does what: **Ajax IT** owns the Azure subscription and the Microsoft tenant; **the developer** runs the steps; **Ajax** owns the Apple account and the legal pages.

## 1. Set-up: one command (about 15 minutes)

Who: someone with **Owner** on an Azure subscription (or Contributor + User Access Administrator).

1. Open **Azure Cloud Shell**: https://shell.azure.com, choose **Bash**.
2. Paste this and press Enter:
   ```bash
   git clone https://github.com/AjaxAgents/Granted && bash Granted/setup/azure-setup.sh
   ```
3. Answer four questions: resource group (`rg-granted-pilot`), region (`southcentralus`), `pilot` or `prod`, and the **admin set-up code** (typed twice, hidden).

[`setup/azure-setup.sh`](../setup/azure-setup.sh) then:

| Step | What it does |
|---|---|
| Azure resources | Turns on the Azure services the subscription needs, then deploys [`infra/main.bicep`](../infra/main.bicep): one Function App that serves the web app at `/` and the API at `/api`, Azure SQL (Entra sign-in only; **you** are its administrator), Key Vault, email (Azure-managed sender domain), Application Insights |
| Secrets | A random session key, and the admin code's PBKDF2 hash (made in Cloud Shell; the code itself is never stored or sent). Kept on re-runs unless you give a new code. |
| Database | Opens the SQL firewall to Cloud Shell for a moment, runs `db/migrations` with [`tools/migrate.mjs`](../apps/api/tools/migrate.mjs) (Entra token, no SQL password) and creates the app's least-privilege user, then closes the firewall again |
| App | Downloads the ready-made `granted-azure.zip` from this repository's latest **Release** (or builds it with `--build`), installs it, restarts, and waits for `/api/health` |

It prints the address, e.g. `https://func-granted-pilot-abc123.azurewebsites.net`. Run the same command again at any time to update the app or retry after a problem.

**If something goes wrong**

| Message | Fix |
|---|---|
| Region doesn't offer Flex Consumption | Run again with another region: `centralus` or `eastus2` |
| Key Vault name already in use | A vault from an earlier attempt was deleted and is held for 90 days. Use a new resource group name. |
| Couldn't reach / write Key Vault | Azure roles can take a few minutes. Run again. If it keeps failing, give yourself *Key Vault Secrets Officer* on the vault. |
| Couldn't set up the database | Usually the firewall. Run again: the script allows the address SQL reports. |
| App doesn't answer | Wait five minutes; open the Function App in the Azure portal → Log stream to see why it stopped (a missing Key Vault secret is named in the message). |

**Before production** (each is a few minutes in the Azure portal):

1. **Database administrator:** make an Entra group for IT the SQL administrator instead of the person who ran set-up: `az sql server ad-admin create -g <rg> -s <sql server> -u "Granted SQL Admins" -i <group object id>`.
2. **Email domain:** in the Email Communication Service, add and verify an Ajax subdomain (e.g. `granted.ajaxbuilding.com`), connect it, and set `MAIL_FROM` on the Function App. The Azure-managed domain has low sending limits.
3. **Web address:** add a custom domain to the Function App (`granted.ajaxbuilding.com`) and set `APP_URL` to it.
4. **Monitoring:** add the alerts in section 5.

**By hand instead of the script:** deploy `infra/main.bicep` with `infra/main.parameters.json`, set the `session-secret` and `admin-setup-code-hash` secrets (`node tools/admin-code-hash.mjs` makes the hash), run the two migrations as the SQL administrator (`002` after replacing `<function-app-name>`), build the package with `bash setup/package-azure.sh`, and zip-deploy it to the Function App.

## 2. Releases and updates from GitHub

- **Release package.** Push a version tag (`git tag v1.0.1 && git push --tags`) or run **Actions → Release** with a version. It tests, builds `granted-azure.zip` and attaches it to a GitHub Release; the set-up script installs the latest one.
- **Deploy from GitHub (optional).** In Entra, create an app registration with a **federated credential** for this repository, scoped to the `pilot` and `prod` environments (OpenID Connect, no passwords), and give it *Website Contributor* on the Function App. In GitHub → Settings → Environments, create `pilot` and `prod` (required reviewers on `prod`) with the variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` and `APP_NAME`. Then run **Actions → Deploy to Azure**.

## 3. After deploying: check it works

- `https://<app address>/api/health` returns `{"ok":true,...}`.
- Sign up with an `@ajaxbuilding.com` email and the admin set-up code. The code email arrives, the account becomes an admin account, and `account.adminGranted` appears in the audit table.
- Create a project, invite a test contractor and a test gate account, book a delivery, scan it, and turn one away. The emails arrive, and the gate log shows both.

## 4. iPhone app

On a Mac with **Xcode 26** or later:

```bash
npm ci
cd apps/web
VITE_API_BASE=https://<app address>/api npm run ios:sync
npm run ios:open
```

In Xcode:

1. Select the App target and set the Team to Ajax's Apple Developer account. The bundle ID is `com.ajaxbuilding.granted`.
2. Set the version (Marketing Version) and build number.
3. Product → Archive → Distribute → App Store Connect → TestFlight.
4. The API already allows the app (`ALLOWED_ORIGINS` includes `capacitor://localhost`).
5. Fill in App Store Connect from [apple-app-store.md](apple-app-store.md): privacy label, age rating, review account, support and privacy URLs.

## 5. Running it

| Task | How |
|---|---|
| Weekly look-ahead | Project Settings → Look-ahead → Upload CSV (ID, Activity, Trade, Start, Finish). See `docs/sample-lookahead.csv`. |
| No-shows | Automatic every hour (`noShowSweep` timer). Admins can also run it from Activity. |
| Someone locked out | They wait 15 minutes or use Forgot password. Nothing for IT to do. |
| Lost admin access | Another admin of the project changes their role. If no admin is left, IT can update `members` in SQL. This is audited, and the app prevents it in normal use. |
| Change the admin set-up code | Run the set-up command again and type the new code (or put a new hash from `node tools/admin-code-hash.mjs` in Key Vault and restart the Function App) |
| Suspend a company | Project Settings → Companies → Suspend |
| Backups | Azure SQL point-in-time restore (7–35 days) and geo-backups |
| Alerts | In Application Insights, alert on: HTTP 5xx above 1%; `account.adminGranted`; more than 20 `account.locked` in an hour; red gate results above normal |
| Updates | Dependabot opens weekly pull requests. CI must pass, then merge and deploy. Rebuild the iPhone app each year for Apple's new SDK requirement. |
| Data requests | Privacy requests to the address in the privacy policy. Account deletion is self-service in the app. |

## 6. Cost outline

Confirm with the [Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/).

| Item | Expected size |
|---|---|
| Azure Functions (Flex Consumption), serving the app and the API | Low: pay per execution; pilot traffic is small |
| Azure SQL serverless (GP, 0.5–1 vCore) | The largest line item; auto-pauses in the pilot |
| Communication Services Email | Per email sent; cents per thousand |
| Key Vault, Application Insights, Storage | Small |
| Apple Developer Program | US$99 a year |
| Entra External ID (if used) | Free for the first 50,000 monthly active users |
