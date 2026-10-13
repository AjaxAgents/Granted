/*
  Granted schema, version 1.
  Each collection the services use is one table: an id, the record as JSON in
  `data`, and computed columns (c_<field>) that are indexed for the lookups the
  services make. See apps/api/src/sql-store.ts. Run once per database, in order,
  as a database owner (the GitHub workflow or `sqlcmd -i`).
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;  -- needed for indexes on computed columns (sqlcmd defaults it OFF)
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF SCHEMA_ID(N'granted') IS NULL EXEC(N'CREATE SCHEMA granted AUTHORIZATION dbo');

-- People. Email is unique among active accounts (enforced by the API; deleted accounts get a placeholder address).
CREATE TABLE granted.[users] (
  id NVARCHAR(100) NOT NULL CONSTRAINT PK_users PRIMARY KEY,
  data NVARCHAR(MAX) NOT NULL CONSTRAINT CK_users_json CHECK (ISJSON(data) = 1),
  c_email AS CAST(JSON_VALUE(data, '$.email') AS NVARCHAR(320))
);
CREATE INDEX IX_users_email ON granted.[users] (c_email);

-- Password hashes for local sign-in (PBKDF2-SHA256, per-user salt). Never returned by the API.
CREATE TABLE granted.[credentials] (
  id NVARCHAR(100) NOT NULL CONSTRAINT PK_credentials PRIMARY KEY,
  data NVARCHAR(MAX) NOT NULL CONSTRAINT CK_credentials_json CHECK (ISJSON(data) = 1)
);

-- Projects with their settings, gates, staging zones and look-ahead (JSON).
CREATE TABLE granted.[projects] (
  id NVARCHAR(100) NOT NULL CONSTRAINT PK_projects PRIMARY KEY,
  data NVARCHAR(MAX) NOT NULL CONSTRAINT CK_projects_json CHECK (ISJSON(data) = 1),
  c_code AS CAST(JSON_VALUE(data, '$.code') AS NVARCHAR(40)),
  c_deleted AS CAST(JSON_VALUE(data, '$.deleted') AS NVARCHAR(10))
);
CREATE INDEX IX_projects_code ON granted.[projects] (c_code);
CREATE INDEX IX_projects_deleted ON granted.[projects] (c_deleted);

-- Who is on which project, with which access (contractor / access / admin).
CREATE TABLE granted.[members] (
  id NVARCHAR(100) NOT NULL CONSTRAINT PK_members PRIMARY KEY,
  data NVARCHAR(MAX) NOT NULL CONSTRAINT CK_members_json CHECK (ISJSON(data) = 1),
  c_projectId AS CAST(JSON_VALUE(data, '$.projectId') AS NVARCHAR(100)),
  c_userId AS CAST(JSON_VALUE(data, '$.userId') AS NVARCHAR(100)),
  c_status AS CAST(JSON_VALUE(data, '$.status') AS NVARCHAR(20))
);
CREATE INDEX IX_members_projectId ON granted.[members] (c_projectId);
CREATE INDEX IX_members_userId ON granted.[members] (c_userId);
CREATE INDEX IX_members_status ON granted.[members] (c_status);

-- Requests to join a project with its code, waiting for a project admin.
CREATE TABLE granted.[joinreqs] (
  id NVARCHAR(100) NOT NULL CONSTRAINT PK_joinreqs PRIMARY KEY,
  data NVARCHAR(MAX) NOT NULL CONSTRAINT CK_joinreqs_json CHECK (ISJSON(data) = 1),
  c_projectId AS CAST(JSON_VALUE(data, '$.projectId') AS NVARCHAR(100)),
  c_userId AS CAST(JSON_VALUE(data, '$.userId') AS NVARCHAR(100)),
  c_status AS CAST(JSON_VALUE(data, '$.status') AS NVARCHAR(20))
);
CREATE INDEX IX_joinreqs_projectId ON granted.[joinreqs] (c_projectId);
CREATE INDEX IX_joinreqs_userId ON granted.[joinreqs] (c_userId);
CREATE INDEX IX_joinreqs_status ON granted.[joinreqs] (c_status);

-- Single-use invites bound to one email, expiring after 7 days.
CREATE TABLE granted.[invites] (
  id NVARCHAR(100) NOT NULL CONSTRAINT PK_invites PRIMARY KEY,
  data NVARCHAR(MAX) NOT NULL CONSTRAINT CK_invites_json CHECK (ISJSON(data) = 1),
  c_projectId AS CAST(JSON_VALUE(data, '$.projectId') AS NVARCHAR(100)),
  c_email AS CAST(JSON_VALUE(data, '$.email') AS NVARCHAR(320)),
  c_status AS CAST(JSON_VALUE(data, '$.status') AS NVARCHAR(20))
);
CREATE INDEX IX_invites_projectId ON granted.[invites] (c_projectId);
CREATE INDEX IX_invites_email ON granted.[invites] (c_email);
CREATE INDEX IX_invites_status ON granted.[invites] (c_status);

-- Delivery requests and the rules engine decision.
CREATE TABLE granted.[requests] (
  id NVARCHAR(100) NOT NULL CONSTRAINT PK_requests PRIMARY KEY,
  data NVARCHAR(MAX) NOT NULL CONSTRAINT CK_requests_json CHECK (ISJSON(data) = 1),
  c_projectId AS CAST(JSON_VALUE(data, '$.projectId') AS NVARCHAR(100)),
  c_userId AS CAST(JSON_VALUE(data, '$.userId') AS NVARCHAR(100)),
  c_status AS CAST(JSON_VALUE(data, '$.status') AS NVARCHAR(20))
);
CREATE INDEX IX_requests_projectId ON granted.[requests] (c_projectId);
CREATE INDEX IX_requests_userId ON granted.[requests] (c_userId);
CREATE INDEX IX_requests_status ON granted.[requests] (c_status);

-- Gate passes (single use).
CREATE TABLE granted.[passes] (
  id NVARCHAR(100) NOT NULL CONSTRAINT PK_passes PRIMARY KEY,
  data NVARCHAR(MAX) NOT NULL CONSTRAINT CK_passes_json CHECK (ISJSON(data) = 1),
  c_projectId AS CAST(JSON_VALUE(data, '$.projectId') AS NVARCHAR(100)),
  c_requestId AS CAST(JSON_VALUE(data, '$.requestId') AS NVARCHAR(100))
);
CREATE INDEX IX_passes_projectId ON granted.[passes] (c_projectId);
CREATE INDEX IX_passes_requestId ON granted.[passes] (c_requestId);

-- Every admit and turn-away at the gate. Append-only.
CREATE TABLE granted.[gatelog] (
  id NVARCHAR(100) NOT NULL CONSTRAINT PK_gatelog PRIMARY KEY,
  data NVARCHAR(MAX) NOT NULL CONSTRAINT CK_gatelog_json CHECK (ISJSON(data) = 1),
  c_projectId AS CAST(JSON_VALUE(data, '$.projectId') AS NVARCHAR(100))
);
CREATE INDEX IX_gatelog_projectId ON granted.[gatelog] (c_projectId);

-- Emails sent about deliveries and project access (the in-app Messages).
CREATE TABLE granted.[mail] (
  id NVARCHAR(100) NOT NULL CONSTRAINT PK_mail PRIMARY KEY,
  data NVARCHAR(MAX) NOT NULL CONSTRAINT CK_mail_json CHECK (ISJSON(data) = 1),
  c_projectId AS CAST(JSON_VALUE(data, '$.projectId') AS NVARCHAR(100)),
  c_to AS CAST(JSON_VALUE(data, '$.to') AS NVARCHAR(320))
);
CREATE INDEX IX_mail_projectId ON granted.[mail] (c_projectId);
CREATE INDEX IX_mail_to ON granted.[mail] (c_to);

-- Sign-ups, approvals, role changes, removals, overrides, deletions, code changes. Append-only.
CREATE TABLE granted.[audit] (
  id NVARCHAR(100) NOT NULL CONSTRAINT PK_audit PRIMARY KEY,
  data NVARCHAR(MAX) NOT NULL CONSTRAINT CK_audit_json CHECK (ISJSON(data) = 1),
  c_projectId AS CAST(JSON_VALUE(data, '$.projectId') AS NVARCHAR(100)),
  c_actorId AS CAST(JSON_VALUE(data, '$.actorId') AS NVARCHAR(100))
);
CREATE INDEX IX_audit_projectId ON granted.[audit] (c_projectId);
CREATE INDEX IX_audit_actorId ON granted.[audit] (c_actorId);

-- Rate-limit counters.
CREATE TABLE granted.[throttle] (
  id NVARCHAR(100) NOT NULL CONSTRAINT PK_throttle PRIMARY KEY,
  data NVARCHAR(MAX) NOT NULL CONSTRAINT CK_throttle_json CHECK (ISJSON(data) = 1)
);

-- Fast lookups the services make together.
CREATE INDEX IX_members_project_status ON granted.[members] (c_projectId, c_status);
CREATE INDEX IX_requests_project_status ON granted.[requests] (c_projectId, c_status);

CREATE TABLE granted.schema_version (version INT NOT NULL PRIMARY KEY, applied_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
INSERT INTO granted.schema_version (version) VALUES (1);

COMMIT TRANSACTION;
