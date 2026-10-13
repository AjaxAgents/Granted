# Operations: set up, release and run

Who does what: **Ajax IT** owns the Azure subscription and the Microsoft tenant; **the developer** runs the steps; **Ajax** owns the Apple account and the legal pages.

## 1. One-time Azure set-up (about half a day)

1. **Resource group** for each environment:
   ```bash
   az group create -n rg-granted-pilot -l southcentralus
   ```
2. **SQL admin group:** an Entra security group for Ajax IT (e.g. `Granted SQL Admins`). Note its object ID.
3. **Deploy the resources:** fill in `infra/main.parameters.json`, then run:
   ```bash
   az deployment group create -g rg-granted-pilot -f infra/main.bicep -p infra/main.parameters.json
   ```
   The outputs give the API host, web host, SQL server, Key Vault name and sender address.
4. **Secrets in Key Vault.** Your account needs the *Key Vault Secrets Officer* role.
   ```bash
   az keyvault secret set --vault-name <kv> -n session-secret --value "$(openssl rand -base64 48)"
   node tools/admin-code-hash.mjs          # type the admin set-up code twice; prints pbkdf2$600000$...
   az keyvault secret set --vault-name <kv> -n admin-setup-code-hash --value 'pbkdf2$600000$...'
   ```
   The code itself is never stored anywhere. To change it later, run the tool again and replace the secret, then restart the Function App.
5. **Database.** Connect as a member of the SQL admin group (Azure Data Studio, SSMS, or `sqlcmd -G`), then run:
   - `db/migrations/001_schema.sql`
   - `db/migrations/002_app_user.sql`, after replacing `<function-app-name>` with the `apiName` output
6. **Email.** The pilot uses the Azure-managed sender domain. For production, add and verify an Ajax subdomain (e.g. `granted.ajaxbuilding.com`) in the Email Communication Service, link it, and update `MAIL_FROM`.
7. **Custom domain** (optional): add `granted.ajaxbuilding.com` to the Static Web App. Then update `APP_URL` and `ALLOWED_ORIGINS` on the Function App, and the `connect-src` in `apps/web/public/staticwebapp.config.json`.

## 2. GitHub deployment set-up

1. In Entra, create an app registration for GitHub deployments with a **federated credential** for this repository, scoped to the `pilot` and `prod` environments (OpenID Connect, so no passwords). Give it *Website Contributor* on the Function App.
2. In the GitHub repository, go to Settings → Environments. Create `pilot` and `prod` (add required reviewers on `prod`) with:
   - Variables: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `API_APP_NAME`, `API_BASE_URL` (`https://<api host>/api`)
   - Secret: `SWA_DEPLOYMENT_TOKEN` (from the Static Web App → Manage deployment token)
3. Run **Actions → Deploy to Azure** and choose the environment.

## 3. After deploying: check it works

- `https://<api host>/api/health` returns `{"ok":true,...}`.
- Sign up with an `@ajaxbuilding.com` email and the admin set-up code. The code email arrives, the account becomes an admin account, and `account.adminGranted` appears in the audit table.
- Create a project, invite a test contractor and a test gate account, book a delivery, scan it, and turn one away. The emails arrive, and the gate log shows both.

## 4. iPhone app

On a Mac with **Xcode 26** or later:

```bash
npm ci
cd apps/web
VITE_API_BASE=https://<api host>/api npm run ios:sync
npm run ios:open
```

In Xcode:

1. Select the App target and set the Team to Ajax's Apple Developer account. The bundle ID is `com.ajaxbuilding.granted`.
2. Set the version (Marketing Version) and build number.
3. Product → Archive → Distribute → App Store Connect → TestFlight.
4. Add `API_BASE_URL`'s origin and `capacitor://localhost` to the API's `ALLOWED_ORIGINS` (the Bicep parameter already includes `capacitor://localhost`).
5. Fill in App Store Connect from [apple-app-store.md](apple-app-store.md): privacy label, age rating, review account, support and privacy URLs.

## 5. Running it

| Task | How |
|---|---|
| Weekly look-ahead | Project Settings → Look-ahead → Upload CSV (ID, Activity, Trade, Start, Finish). See `docs/sample-lookahead.csv`. |
| No-shows | Automatic every hour (`noShowSweep` timer). Admins can also run it from Activity. |
| Someone locked out | They wait 15 minutes or use Forgot password. Nothing for IT to do. |
| Lost admin access | Another admin of the project changes their role. If no admin is left, IT can update `members` in SQL. This is audited, and the app prevents it in normal use. |
| Change the admin set-up code | New hash into Key Vault (step 1.4), then restart the Function App |
| Suspend a company | Project Settings → Companies → Suspend |
| Backups | Azure SQL point-in-time restore (7–35 days) and geo-backups |
| Alerts | In Application Insights, alert on: HTTP 5xx above 1%; `account.adminGranted`; more than 20 `account.locked` in an hour; red gate results above normal |
| Updates | Dependabot opens weekly pull requests. CI must pass, then merge and deploy. Rebuild the iPhone app each year for Apple's new SDK requirement. |
| Data requests | Privacy requests to the address in the privacy policy. Account deletion is self-service in the app. |

## 6. Cost outline

Confirm with the [Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/).

| Item | Expected size |
|---|---|
| Azure Functions (Flex Consumption) | Low: pay per execution; pilot traffic is small |
| Azure SQL serverless (GP, 0.5–1 vCore) | The largest line item; auto-pauses in the pilot |
| Communication Services Email | Per email sent; cents per thousand |
| Static Web Apps | Free (pilot) / Standard (production, custom domain and SLA) |
| Key Vault, Application Insights, Storage | Small |
| Apple Developer Program | US$99 a year |
| Entra External ID (if used) | Free for the first 50,000 monthly active users |
