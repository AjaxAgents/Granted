/*
  Least-privilege database user for the API.
  The Function App signs in with its managed identity (no password exists).
  setup/azure-setup.sh runs this for you (tools/migrate.mjs fills in the name).
  By hand: replace <function-app-name> with the Function App's name, then run
  as the Microsoft Entra admin of the Azure SQL server. Safe to run again.

  The app can read and write records, but:
    - cannot change the schema,
    - cannot change or delete the gate log or the audit log (append-only).
*/
IF DATABASE_PRINCIPAL_ID(N'<function-app-name>') IS NULL
  CREATE USER [<function-app-name>] FROM EXTERNAL PROVIDER;
IF DATABASE_PRINCIPAL_ID(N'granted_app') IS NULL
  CREATE ROLE granted_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::granted TO granted_app;
DENY UPDATE, DELETE ON granted.[gatelog] TO granted_app;
DENY UPDATE, DELETE ON granted.[audit] TO granted_app;
DENY INSERT, UPDATE, DELETE ON granted.schema_version TO granted_app;
-- sp_getapplock (used to serialise capacity checks per project) is available to every user by default.
IF IS_ROLEMEMBER(N'granted_app', N'<function-app-name>') = 0 OR IS_ROLEMEMBER(N'granted_app', N'<function-app-name>') IS NULL
  ALTER ROLE granted_app ADD MEMBER [<function-app-name>];
