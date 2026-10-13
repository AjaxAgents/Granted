// Granted: Azure resources for one environment (pilot or production).
//
//   az group create -n rg-granted-prod -l southcentralus
//   az deployment group create -g rg-granted-prod -f infra/main.bicep -p infra/main.parameters.json
//
// Creates: Function App (Flex Consumption, Node 22) with a managed identity,
// Azure SQL (Microsoft Entra authentication only, serverless), Key Vault (RBAC),
// Azure Communication Services Email, Static Web App for the web app,
// Application Insights, and the role assignments between them.
// Secrets are added to Key Vault after deployment (docs/operations.md); none are in this file.

@description('Short name used in resource names, e.g. granted')
param appName string = 'granted'
@description('Environment: pilot or prod')
@allowed(['pilot', 'prod'])
param env string = 'pilot'
param location string = resourceGroup().location
@description('Object ID of the Microsoft Entra group that administers the SQL server (Ajax IT)')
param sqlAdminGroupObjectId string
@description('Display name of that group')
param sqlAdminGroupName string
@description('Origins allowed to call the API, e.g. https://granted.ajaxbuilding.com,capacitor://localhost')
param allowedOrigins string
@description('Public URL of the web app, used in emails')
param appUrl string
@description('Static Web Apps region (limited list)')
param staticWebAppLocation string = 'centralus'

var suffix = toLower('${appName}-${env}-${uniqueString(resourceGroup().id)}')
var short = toLower(replace('${appName}${env}${uniqueString(resourceGroup().id)}', '-', ''))

// ---------------------------------------------------------------- monitoring
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${suffix}'
  location: location
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 90 }
}
resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${suffix}'
  location: location
  kind: 'web'
  properties: { Application_Type: 'web', WorkspaceResourceId: logs.id, DisableLocalAuth: true }
}

// ---------------------------------------------------------------- storage for the Function App
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: take('st${short}', 24)
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    supportsHttpsTrafficOnly: true
  }
}
resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = { parent: storage, name: 'default' }
resource deployContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = { parent: blobs, name: 'deployments' }

// ---------------------------------------------------------------- Key Vault
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: take('kv-${short}', 24)
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
  }
}

// ---------------------------------------------------------------- Azure SQL (Entra authentication only)
resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: 'sql-${suffix}'
  location: location
  properties: {
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    administrators: {
      administratorType: 'ActiveDirectory'
      azureADOnlyAuthentication: true
      login: sqlAdminGroupName
      sid: sqlAdminGroupObjectId
      tenantId: subscription().tenantId
      principalType: 'Group'
    }
  }
}
resource sqlAllowAzure 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: sqlServer
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}
resource sqlDb 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServer
  name: 'granted'
  location: location
  sku: { name: 'GP_S_Gen5_1', tier: 'GeneralPurpose' }
  properties: {
    autoPauseDelay: env == 'prod' ? -1 : 60
    minCapacity: json('0.5')
    requestedBackupStorageRedundancy: 'Geo'
    zoneRedundant: false
  }
}
resource sqlAudit 'Microsoft.Sql/servers/auditingSettings@2023-08-01-preview' = {
  parent: sqlServer
  name: 'default'
  properties: { state: 'Enabled', isAzureMonitorTargetEnabled: true }
}

// ---------------------------------------------------------------- email (Azure Communication Services)
resource emailService 'Microsoft.Communication/emailServices@2023-04-01' = {
  name: 'acs-email-${suffix}'
  location: 'global'
  properties: { dataLocation: 'United States' }
}
// Azure-managed sender domain for the pilot. For production, add Ajax's own domain (e.g. granted.ajaxbuilding.com) and verify it.
resource emailDomain 'Microsoft.Communication/emailServices/domains@2023-04-01' = {
  parent: emailService
  name: 'AzureManagedDomain'
  location: 'global'
  properties: { domainManagement: 'AzureManaged', userEngagementTracking: 'Disabled' }
}
resource acs 'Microsoft.Communication/communicationServices@2023-04-01' = {
  name: 'acs-${suffix}'
  location: 'global'
  properties: { dataLocation: 'United States', linkedDomains: [emailDomain.id] }
}

// ---------------------------------------------------------------- API (Azure Functions, Flex Consumption)
resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'plan-${suffix}'
  location: location
  kind: 'functionapp'
  sku: { tier: 'FlexConsumption', name: 'FC1' }
  properties: { reserved: true }
}
var kv = 'https://${vault.name}${environment().suffixes.keyvaultDns}/secrets'
resource api 'Microsoft.Web/sites@2024-04-01' = {
  name: 'func-${suffix}'
  location: location
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    functionAppConfig: {
      deployment: { storage: { type: 'blobContainer', value: '${storage.properties.primaryEndpoints.blob}deployments', authentication: { type: 'SystemAssignedIdentity' } } }
      scaleAndConcurrency: { maximumInstanceCount: 40, instanceMemoryMB: 2048 }
      runtime: { name: 'node', version: '22' }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      appSettings: [
        { name: 'AzureWebJobsStorage__accountName', value: storage.name }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
        { name: 'APPLICATIONINSIGHTS_AUTHENTICATION_STRING', value: 'Authorization=AAD' }
        { name: 'TZ', value: 'UTC' }
        { name: 'GRANTED_ENV', value: env == 'prod' ? 'production' : 'pilot' }
        { name: 'GRANTED_STORE', value: 'sql' }
        { name: 'SQL_SERVER', value: sqlServer.properties.fullyQualifiedDomainName }
        { name: 'SQL_DATABASE', value: sqlDb.name }
        { name: 'SESSION_SECRET', value: '@Microsoft.KeyVault(SecretUri=${kv}/session-secret)' }
        { name: 'ADMIN_SETUP_CODE_HASH', value: '@Microsoft.KeyVault(SecretUri=${kv}/admin-setup-code-hash)' }
        { name: 'ACS_ENDPOINT', value: 'https://${acs.properties.hostName}' }
        { name: 'MAIL_FROM', value: 'DoNotReply@${emailDomain.properties.fromSenderDomain}' }
        { name: 'APP_URL', value: appUrl }
        { name: 'ALLOWED_ORIGINS', value: allowedOrigins }
        { name: 'AUTH_MODE', value: 'local' }
        { name: 'EXPOSE_CODES', value: 'false' }
      ]
    }
  }
}

// ---------------------------------------------------------------- web app (Static Web Apps)
resource web 'Microsoft.Web/staticSites@2024-04-01' = {
  name: 'swa-${suffix}'
  location: staticWebAppLocation
  sku: { name: env == 'prod' ? 'Standard' : 'Free', tier: env == 'prod' ? 'Standard' : 'Free' }
  properties: {}
}

// ---------------------------------------------------------------- role assignments for the API's managed identity
var roles = {
  blobOwner: 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
  queueContributor: '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
  tableContributor: '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
  kvSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
  monitoringPublisher: '3913510d-42f4-4e42-8a64-420c390055eb'
  contributor: 'b24988ac-6180-42a0-ab88-20f7382dd24c'
}
resource rBlob 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, api.id, roles.blobOwner)
  scope: storage
  properties: { roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.blobOwner), principalId: api.identity.principalId, principalType: 'ServicePrincipal' }
}
resource rQueue 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, api.id, roles.queueContributor)
  scope: storage
  properties: { roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.queueContributor), principalId: api.identity.principalId, principalType: 'ServicePrincipal' }
}
resource rTable 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, api.id, roles.tableContributor)
  scope: storage
  properties: { roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.tableContributor), principalId: api.identity.principalId, principalType: 'ServicePrincipal' }
}
resource rVault 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, api.id, roles.kvSecretsUser)
  scope: vault
  properties: { roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.kvSecretsUser), principalId: api.identity.principalId, principalType: 'ServicePrincipal' }
}
resource rInsights 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(insights.id, api.id, roles.monitoringPublisher)
  scope: insights
  properties: { roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.monitoringPublisher), principalId: api.identity.principalId, principalType: 'ServicePrincipal' }
}
// Sending email with the managed identity (no ACS access key in settings).
resource rAcs 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acs.id, api.id, roles.contributor)
  scope: acs
  properties: { roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.contributor), principalId: api.identity.principalId, principalType: 'ServicePrincipal' }
}

output apiHost string = api.properties.defaultHostName
output apiName string = api.name
output webHost string = web.properties.defaultHostname
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
output keyVaultName string = vault.name
output mailFrom string = 'DoNotReply@${emailDomain.properties.fromSenderDomain}'
