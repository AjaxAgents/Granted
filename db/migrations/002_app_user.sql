/*
  Least-privilege database user for the API.
  The Function App signs in with its managed identity (no password exists).
  Replace <function-app-name> with the Function App's name, then run as the
  Microsoft Entra admin of the Azure SQL server.

  The app can read and write records, but:
    - cannot change the schema,
    - cannot change or delete the gate log or the audit log (append-only).
*/
CREATE USER [<function-app-name>] FROM EXTERNAL PROVIDER;
CREATE ROLE granted_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::granted TO granted_app;
DENY UPDATE, DELETE ON granted.[gatelog] TO granted_app;
DENY UPDATE, DELETE ON granted.[audit] TO granted_app;
DENY INSERT, UPDATE, DELETE ON granted.schema_version TO granted_app;
-- sp_getapplock (used to serialise capacity checks per project) is available to every user by default.
ALTER ROLE granted_app ADD MEMBER [<function-app-name>];
