-- Automation 015 Stage 2: optional isolated durable ledger storage.
-- Apply only to an explicitly provisioned trusted database. NOT a game DB migration.
-- Restrict this schema to a trusted service identity. Do not grant PR CI write access.
CREATE SCHEMA IF NOT EXISTS automation_audit;
CREATE TABLE IF NOT EXISTS automation_audit.ledger_heads (
  task_key text PRIMARY KEY,
  sequence bigint NOT NULL CHECK (sequence > 0),
  digest text NOT NULL CHECK (digest ~ '^sha256:[a-f0-9]{64}$')
);
CREATE TABLE IF NOT EXISTS automation_audit.ledger_events (
  task_key text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_id text NOT NULL,
  digest text NOT NULL CHECK (digest ~ '^sha256:[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  PRIMARY KEY(task_key,sequence),
  UNIQUE(task_key,event_id),
  UNIQUE(task_key,digest)
);
-- Do not allow ordinary ledger writers to UPDATE or DELETE event history.
-- A DB superuser or schema owner can still alter tables: HMAC verification with
-- a separately held secret detects modification but not all rollback attacks.
