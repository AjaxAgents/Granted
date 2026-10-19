#!/usr/bin/env bash
# =====================================================================================
#  Granted: one-command Azure set-up
#
#  Open Azure Cloud Shell (https://shell.azure.com, choose Bash) and paste:
#
#     git clone https://github.com/AjaxAgents/Granted && bash Granted/setup/azure-setup.sh
#
#  It asks four questions (resource group, region, pilot or prod, admin set-up code),
#  then, in about 15 minutes:
#    1. creates every Azure resource (infra/main.bicep): app, database, Key Vault, email, monitoring
#    2. puts the secrets in Key Vault (a random session key, and the admin code's hash, never the code)
#    3. sets up the database tables and the app's least-privilege database user
#    4. installs the app and prints its web address
#
#  Safe to run again (to update the app, or after fixing a problem): it keeps existing secrets
#  unless you give a new admin code, and the database steps skip what's already done.
#
#  You need: Owner (or Contributor + User Access Administrator) on the Azure subscription.
#  For unattended runs, set GRANTED_RG, GRANTED_LOCATION, GRANTED_ENV and GRANTED_ADMIN_CODE.
#  Add --build to build from this folder instead of downloading the ready-made package.
# =====================================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
FW_RULE=""
BUILD_LOCAL=0
for a in "$@"; do [ "$a" = "--build" ] && BUILD_LOCAL=1; done

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
note() { printf '  %s\n' "$*"; }
die()  { printf '\n\033[31mStopped:\033[0m %s\n' "$*" >&2; exit 1; }
cleanup() {
  if [ -n "$FW_RULE" ] && [ -n "${RG:-}" ] && [ -n "${SQL_NAME:-}" ]; then
    az sql server firewall-rule delete -g "$RG" -s "$SQL_NAME" -n "$FW_RULE" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# Retries a command (Azure permissions can take a few minutes to take effect).
retry() {
  local tries=$1 wait=$2; shift 2
  local i
  for ((i = 1; i <= tries; i++)); do
    if "$@"; then return 0; fi
    [ "$i" -lt "$tries" ] && { note "not ready yet, trying again in ${wait}s ($i/$tries)"; sleep "$wait"; }
  done
  return 1
}

ask() { # ask VAR "Question" default
  local __v=$1 q=$2 d=${3:-} ans
  if [ -n "${!__v:-}" ]; then return; fi
  read -rp "  $q [$d]: " ans || true
  printf -v "$__v" '%s' "${ans:-$d}"
}

cat <<'EOF'

  ┌──────────────────────────────────────────────────────────┐
  │  GRANTED  ·  Azure set-up                                │
  │  No approved delivery, no gate access.                   │
  └──────────────────────────────────────────────────────────┘
EOF

# ------------------------------------------------------------------ 0. checks
bold "Checking your Azure sign-in"
command -v az >/dev/null || die "The Azure CLI isn't here. Run this in Azure Cloud Shell (https://shell.azure.com)."
command -v node >/dev/null || die "Node.js isn't here. Run this in Azure Cloud Shell, or install Node.js 22."
az account show >/dev/null 2>&1 || az login --use-device-code >/dev/null
SUB_NAME=$(az account show --query name -o tsv)
SUB_ID=$(az account show --query id -o tsv)
ME_ID=$(az ad signed-in-user show --query id -o tsv 2>/dev/null) || die "Couldn't read your Microsoft Entra account. Sign in as a person (not a service principal): az login"
ME_UPN=$(az ad signed-in-user show --query userPrincipalName -o tsv)
ok "Signed in as $ME_UPN"
ok "Subscription: $SUB_NAME ($SUB_ID)"
note "Wrong subscription? Press Ctrl+C, run: az account set -s \"<name or id>\", then run this again."

# ------------------------------------------------------------------ 1. questions
bold "Four questions (press Enter to accept the suggestion in brackets)"
ask GRANTED_RG "Resource group name" "rg-granted-pilot"
ask GRANTED_LOCATION "Azure region (southcentralus is Texas)" "southcentralus"
ask GRANTED_ENV "pilot or prod" "pilot"
RG=$GRANTED_RG; LOC=$GRANTED_LOCATION; ENVN=$GRANTED_ENV
[[ "$ENVN" == "pilot" || "$ENVN" == "prod" ]] || die "Environment must be pilot or prod."
[[ "$RG" =~ ^[A-Za-z0-9._()-]{1,90}$ ]] || die "That resource group name has characters Azure doesn't allow."

if [ -z "${GRANTED_ADMIN_CODE:-}" ]; then
  note ""
  note "Admin set-up code: people with a confirmed @ajaxbuilding.com email type this as a"
  note "project code to become Ajax admins (able to create projects). Only a one-way hash is"
  note "stored. Leave it empty on a re-run to keep the current code."
  read -rsp "  Admin set-up code: " C1; echo
  if [ -n "$C1" ]; then read -rsp "  Type it again:     " C2; echo; [ "$C1" = "$C2" ] || die "The two codes didn't match. Run this again."; fi
  GRANTED_ADMIN_CODE=$C1; unset C1 C2
fi

# ------------------------------------------------------------------ 2. Azure resources
bold "Step 1 of 4 · Creating the Azure resources (5–10 minutes)"
for ns in Microsoft.Web Microsoft.Sql Microsoft.KeyVault Microsoft.Communication Microsoft.Insights Microsoft.OperationalInsights Microsoft.Storage; do
  state=$(az provider show -n "$ns" --query registrationState -o tsv 2>/dev/null || echo NotRegistered)
  if [ "$state" != "Registered" ]; then note "turning on $ns for this subscription"; az provider register -n "$ns" --wait >/dev/null; fi
done
ok "Azure services available"
az group create -n "$RG" -l "$LOC" -o none
ok "Resource group $RG ($LOC)"

OUT=$(az deployment group create -g "$RG" -n granted-setup -f "$ROOT/infra/main.bicep" \
  -p env="$ENVN" sqlAdminObjectId="$ME_ID" sqlAdminName="$ME_UPN" sqlAdminPrincipalType=User setupUserObjectId="$ME_ID" \
  --query properties.outputs -o json) || die "The Azure deployment failed (see the message above). Common causes: the region doesn't offer Flex Consumption (try centralus or eastus2), or a Key Vault with the same name was deleted recently (use a new resource group name)."
val() { printf '%s' "$OUT" | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(JSON.parse(s)['$1'].value))"; }
APP_NAME=$(val apiName); APP_URL=$(val appUrl); KV=$(val keyVaultName)
SQL_NAME=$(val sqlServerName); SQL_FQDN=$(val sqlServerFqdn); MAIL_FROM=$(val mailFrom)
ok "App $APP_NAME, database $SQL_NAME, Key Vault $KV"

# ------------------------------------------------------------------ 3. secrets
bold "Step 2 of 4 · Putting the secrets in Key Vault"
kv_has() { az keyvault secret show --vault-name "$KV" -n "$1" --query id -o tsv >/dev/null 2>&1; }
kv_set() { az keyvault secret set --vault-name "$KV" -n "$1" --value "$2" -o none 2>/dev/null; }
retry 20 20 az keyvault secret list --vault-name "$KV" -o none 2>/dev/null || die "Couldn't reach Key Vault $KV. Ask IT to give you the 'Key Vault Secrets Officer' role on it, then run this again."
if kv_has session-secret; then ok "Session key already set (kept, so nobody is signed out)"
else retry 5 15 kv_set session-secret "$(openssl rand -base64 48 | tr -d '\n')" || die "Couldn't write to Key Vault."; ok "Session key created"; fi

if [ -n "$GRANTED_ADMIN_CODE" ]; then
  HASH=$(GRANTED_ADMIN_CODE="$GRANTED_ADMIN_CODE" node -e '
    const c = require("crypto");
    const code = String(process.env.GRANTED_ADMIN_CODE).toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 40);
    if (!code) process.exit(3);
    const salt = c.randomBytes(16);
    const h = c.pbkdf2Sync("granted-admin-v1:" + code, salt, 600000, 32, "sha256");
    console.log("pbkdf2$600000$" + salt.toString("base64") + "$" + h.toString("base64"));') || die "That admin code has no letters or numbers."
  unset GRANTED_ADMIN_CODE
  retry 5 15 kv_set admin-setup-code-hash "$HASH" || die "Couldn't write to Key Vault."
  ok "Admin set-up code stored as a hash"
elif kv_has admin-setup-code-hash; then ok "Admin set-up code already set (kept)"
else
  kv_set admin-setup-code-hash "not-set" || true
  note "No admin code yet: nobody can create projects until you run this again with a code."
fi

# ------------------------------------------------------------------ 4. the app package
bold "Step 3 of 4 · Getting the app and setting up the database"
ZIP="$WORK/granted-azure.zip"
REMOTE=$(git -C "$ROOT" config --get remote.origin.url 2>/dev/null || echo "https://github.com/AjaxAgents/Granted")
REPO=$(printf '%s' "$REMOTE" | sed -E 's#(\.git)?$##; s#^.*github\.com[:/]##')
if [ "$BUILD_LOCAL" = 0 ] && curl -fsSL -o "$ZIP" "https://github.com/$REPO/releases/latest/download/granted-azure.zip"; then
  ok "Downloaded the ready-made app package from github.com/$REPO"
else
  note "Building the app from this folder (2–4 minutes)"
  NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
  [ "$NODE_MAJOR" -ge 22 ] || die "Building needs Node.js 22 (this has $(node -v)). Publish a release first (GitHub → Actions → Release → Run workflow), then run this again."
  bash "$ROOT/setup/package-azure.sh" "$ZIP"
fi
mkdir -p "$WORK/pkg" && (cd "$WORK/pkg" && unzip -q "$ZIP")

# The database only accepts Azure services; open it to this Cloud Shell for a moment.
MYIP=$(curl -fsS https://api.ipify.org 2>/dev/null || true)
FW_RULE="granted-setup-$(date +%s)"
if [ -n "$MYIP" ]; then az sql server firewall-rule create -g "$RG" -s "$SQL_NAME" -n "$FW_RULE" --start-ip-address "$MYIP" --end-ip-address "$MYIP" -o none; fi
migrate() {
  local token log="$WORK/migrate.log"
  token=$(az account get-access-token --resource https://database.windows.net/ --query accessToken -o tsv)
  local run=(node)
  [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || run=(npx -y -p node@22 -- node)
  if SQL_SERVER="$SQL_FQDN" SQL_DATABASE=granted SQL_TOKEN="$token" "${run[@]}" "$WORK/pkg/tools/migrate.mjs" --app "$APP_NAME" --dir "$WORK/pkg/migrations" 2>&1 | tee "$log"; then
    grep -q "Database ready" "$log" && return 0
  fi
  # SQL names the address it saw; allow that one and try again.
  local seen; seen=$(grep -oE "IP address '[0-9.]+'" "$log" | grep -oE '[0-9.]+' | head -1 || true)
  if [ -n "$seen" ]; then az sql server firewall-rule create -g "$RG" -s "$SQL_NAME" -n "$FW_RULE" --start-ip-address "$seen" --end-ip-address "$seen" -o none; fi
  return 1
}
retry 3 30 migrate || die "Couldn't set up the database (see the message above)."
az sql server firewall-rule delete -g "$RG" -s "$SQL_NAME" -n "$FW_RULE" -o none 2>/dev/null || true; FW_RULE=""
ok "Database ready (tables, and a database user for the app that can't change the gate or audit logs)"

# ------------------------------------------------------------------ 5. install
bold "Step 4 of 4 · Installing the app"
retry 4 30 az functionapp deployment source config-zip -g "$RG" -n "$APP_NAME" --src "$ZIP" -o none || die "Couldn't install the app package."
az functionapp restart -g "$RG" -n "$APP_NAME" -o none
ok "Installed"
note "Waiting for the app to answer (up to 5 minutes)..."
up() { [ "$(curl -s -o /dev/null -w '%{http_code}' "$APP_URL/api/health")" = "200" ]; }
if retry 20 15 up; then ok "Granted is running"; else note "It hasn't answered yet; give it a few more minutes, then open the address below."; fi

cat <<EOF

  ┌──────────────────────────────────────────────────────────┐
  │  Done. Granted is at:                                    │
  └──────────────────────────────────────────────────────────┘

     $APP_URL

  Next (2 minutes):
    1. Open that address on your phone or computer and tap "Create account".
       Use your @ajaxbuilding.com email; the code arrives from $MAIL_FROM
       (check junk mail the first time).
    2. On "Join a project", type the admin set-up code. You're now an Ajax admin.
    3. Tap "New project", then share the project code with your team.

  Later, when you're ready (docs/operations.md):
    · your own web address (e.g. granted.yourcompany.com) and email domain
    · make an IT group the database administrator instead of you
    · the iPhone app (needs a Mac and an Apple Developer account)

  To update Granted later, run the same command again.

EOF
