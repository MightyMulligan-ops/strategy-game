BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TurnStatus" AS ENUM ('OPEN', 'CLOSED', 'RESOLVING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ClosureReason" AS ENUM ('DEADLINE', 'ALL_READY');

-- CreateEnum
CREATE TYPE "OrderKind" AS ENUM ('MOVE', 'ATTACK');

-- CreateEnum
CREATE TYPE "RevisionKind" AS ENUM ('INITIAL', 'REPLACE_ORDERS', 'CANCEL_ORDER', 'SET_READY');

-- CreateTable
CREATE TABLE "PlayerIdentity" (
    "id" TEXT NOT NULL,

    CONSTRAINT "PlayerIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "currentStateVersion" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchConfiguration" (
    "matchId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "turnDurationMs" BIGINT NOT NULL,
    "rulesetId" TEXT NOT NULL,
    "rulesetVersion" TEXT NOT NULL,
    "simulationVersion" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "pinnedRuleset" JSONB NOT NULL,

    CONSTRAINT "MatchConfiguration_pkey" PRIMARY KEY ("matchId")
);

-- CreateTable
CREATE TABLE "MatchParticipant" (
    "matchId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,

    CONSTRAINT "MatchParticipant_pkey" PRIMARY KEY ("matchId","playerId")
);

-- CreateTable
CREATE TABLE "GameSnapshotRecord" (
    "matchId" TEXT NOT NULL,
    "stateVersion" BIGINT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "completedTurnNumber" BIGINT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "GameSnapshotRecord_pkey" PRIMARY KEY ("matchId","stateVersion")
);

-- CreateTable
CREATE TABLE "Turn" (
    "matchId" TEXT NOT NULL,
    "number" BIGINT NOT NULL,
    "startingStateVersion" BIGINT NOT NULL,
    "status" "TurnStatus" NOT NULL,
    "openedAtMs" BIGINT NOT NULL,
    "deadlineAtMs" BIGINT NOT NULL,
    "lastObservedAtMs" BIGINT NOT NULL,
    "closedAtMs" BIGINT,
    "closeReason" "ClosureReason",

    CONSTRAINT "Turn_pkey" PRIMARY KEY ("matchId","number")
);

-- CreateTable
CREATE TABLE "PlayerTurnState" (
    "matchId" TEXT NOT NULL,
    "turnNumber" BIGINT NOT NULL,
    "playerId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "revision" BIGINT NOT NULL,
    "ready" BOOLEAN NOT NULL,

    CONSTRAINT "PlayerTurnState_pkey" PRIMARY KEY ("matchId","turnNumber","playerId")
);

-- CreateTable
CREATE TABLE "PlayerSubmissionRevision" (
    "matchId" TEXT NOT NULL,
    "turnNumber" BIGINT NOT NULL,
    "playerId" TEXT NOT NULL,
    "revision" BIGINT NOT NULL,
    "kind" "RevisionKind" NOT NULL,
    "ready" BOOLEAN NOT NULL,
    "orders" JSONB NOT NULL,
    "command" JSONB,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerSubmissionRevision_pkey" PRIMARY KEY ("matchId","turnNumber","playerId","revision")
);

-- CreateTable
CREATE TABLE "PlayerOrder" (
    "matchId" TEXT NOT NULL,
    "turnNumber" BIGINT NOT NULL,
    "playerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "OrderKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL,
    "draftPosition" INTEGER,
    "moveNumber" INTEGER,
    "lastRevision" BIGINT NOT NULL,

    CONSTRAINT "PlayerOrder_pkey" PRIMARY KEY ("matchId","turnNumber","playerId","orderId")
);

-- CreateTable
CREATE TABLE "OrderDependency" (
    "matchId" TEXT NOT NULL,
    "turnNumber" BIGINT NOT NULL,
    "playerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "prerequisiteOrderId" TEXT NOT NULL,
    "requiredOutputRef" TEXT,

    CONSTRAINT "OrderDependency_pkey" PRIMARY KEY ("matchId","turnNumber","playerId","orderId","prerequisiteOrderId")
);

-- CreateTable
CREATE TABLE "FrozenTurnInputRecord" (
    "matchId" TEXT NOT NULL,
    "turnNumber" BIGINT NOT NULL,
    "payload" JSONB NOT NULL,
    "seed" BIGINT,
    "frozenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FrozenTurnInputRecord_pkey" PRIMARY KEY ("matchId","turnNumber")
);

-- CreateTable
CREATE TABLE "ResolutionResult" (
    "matchId" TEXT NOT NULL,
    "turnNumber" BIGINT NOT NULL,
    "resolutionId" TEXT NOT NULL,
    "nextStateVersion" BIGINT NOT NULL,
    "payload" JSONB NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResolutionResult_pkey" PRIMARY KEY ("matchId","turnNumber")
);

-- CreateIndex
CREATE INDEX "MatchParticipant_identityId_idx" ON "MatchParticipant"("identityId");

-- CreateIndex
CREATE UNIQUE INDEX "GameSnapshotRecord_snapshotId_key" ON "GameSnapshotRecord"("snapshotId");

-- CreateIndex
CREATE INDEX "Turn_status_deadlineAtMs_idx" ON "Turn"("status", "deadlineAtMs");

-- CreateIndex
CREATE INDEX "PlayerOrder_matchId_turnNumber_playerId_active_idx" ON "PlayerOrder"("matchId", "turnNumber", "playerId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ResolutionResult_resolutionId_key" ON "ResolutionResult"("resolutionId");

-- AddForeignKey
ALTER TABLE "MatchConfiguration" ADD CONSTRAINT "MatchConfiguration_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "PlayerIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSnapshotRecord" ADD CONSTRAINT "GameSnapshotRecord_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turn" ADD CONSTRAINT "Turn_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turn" ADD CONSTRAINT "Turn_matchId_startingStateVersion_fkey" FOREIGN KEY ("matchId", "startingStateVersion") REFERENCES "GameSnapshotRecord"("matchId", "stateVersion") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerTurnState" ADD CONSTRAINT "PlayerTurnState_matchId_turnNumber_fkey" FOREIGN KEY ("matchId", "turnNumber") REFERENCES "Turn"("matchId", "number") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerTurnState" ADD CONSTRAINT "PlayerTurnState_matchId_playerId_fkey" FOREIGN KEY ("matchId", "playerId") REFERENCES "MatchParticipant"("matchId", "playerId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerSubmissionRevision" ADD CONSTRAINT "PlayerSubmissionRevision_matchId_turnNumber_playerId_fkey" FOREIGN KEY ("matchId", "turnNumber", "playerId") REFERENCES "PlayerTurnState"("matchId", "turnNumber", "playerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerOrder" ADD CONSTRAINT "PlayerOrder_matchId_turnNumber_playerId_fkey" FOREIGN KEY ("matchId", "turnNumber", "playerId") REFERENCES "PlayerTurnState"("matchId", "turnNumber", "playerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDependency" ADD CONSTRAINT "OrderDependency_matchId_turnNumber_playerId_orderId_fkey" FOREIGN KEY ("matchId", "turnNumber", "playerId", "orderId") REFERENCES "PlayerOrder"("matchId", "turnNumber", "playerId", "orderId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDependency" ADD CONSTRAINT "OrderDependency_matchId_turnNumber_playerId_prerequisiteOr_fkey" FOREIGN KEY ("matchId", "turnNumber", "playerId", "prerequisiteOrderId") REFERENCES "PlayerOrder"("matchId", "turnNumber", "playerId", "orderId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrozenTurnInputRecord" ADD CONSTRAINT "FrozenTurnInputRecord_matchId_turnNumber_fkey" FOREIGN KEY ("matchId", "turnNumber") REFERENCES "Turn"("matchId", "number") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResolutionResult" ADD CONSTRAINT "ResolutionResult_matchId_turnNumber_fkey" FOREIGN KEY ("matchId", "turnNumber") REFERENCES "Turn"("matchId", "number") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResolutionResult" ADD CONSTRAINT "ResolutionResult_matchId_nextStateVersion_fkey" FOREIGN KEY ("matchId", "nextStateVersion") REFERENCES "GameSnapshotRecord"("matchId", "stateVersion") ON DELETE NO ACTION ON UPDATE CASCADE;

-- PostgreSQL-specific invariants not expressible in the Prisma data model.
CREATE UNIQUE INDEX "one_unresolved_turn_per_match" ON "Turn" ("matchId") WHERE "status" <> 'RESOLVED';
CREATE UNIQUE INDEX "active_draft_position" ON "PlayerOrder" ("matchId", "turnNumber", "playerId", "draftPosition") WHERE "active";
CREATE UNIQUE INDEX "active_move_number" ON "PlayerOrder" ("matchId", "turnNumber", "playerId", "moveNumber") WHERE "active" AND "moveNumber" IS NOT NULL;

ALTER TABLE "Match" ADD CONSTRAINT "safe_match_version" CHECK ("currentStateVersion" BETWEEN 0 AND 9007199254740991);
ALTER TABLE "MatchConfiguration" ADD CONSTRAINT "valid_fixed_configuration" CHECK (
  "schemaVersion" = 1 AND "turnDurationMs" BETWEEN 1 AND 9007199254740991
  AND "config"->>'gameId' = "matchId" AND ("config"->>'schemaVersion')::int = "schemaVersion"
  AND ("config"->>'turnDurationMs')::bigint = "turnDurationMs"
  AND "pinnedRuleset"#>>'{ruleset,rulesetId}' = "rulesetId"
  AND "pinnedRuleset"#>>'{ruleset,version}' = "rulesetVersion"
  AND "pinnedRuleset"->>'simulationVersion' = "simulationVersion"
);
ALTER TABLE "GameSnapshotRecord" ADD CONSTRAINT "safe_snapshot_version" CHECK (
  "stateVersion" BETWEEN 0 AND 9007199254740991 AND "completedTurnNumber" BETWEEN 0 AND 9007199254740991
  AND "payload"->>'snapshotId' = "snapshotId" AND "payload"#>>'{config,gameId}' = "matchId"
  AND ("payload"->>'stateVersion')::bigint = "stateVersion"
  AND ("payload"->>'completedTurnNumber')::bigint = "completedTurnNumber"
);
ALTER TABLE "Turn" ADD CONSTRAINT "valid_turn_clock" CHECK (
  "number" BETWEEN 1 AND 9007199254740991 AND "startingStateVersion" BETWEEN 0 AND 9007199254740991
  AND "openedAtMs" >= 0 AND "deadlineAtMs" > "openedAtMs" AND "deadlineAtMs" <= 9007199254740991
  AND "lastObservedAtMs" BETWEEN "openedAtMs" AND 9007199254740991
  AND (("status" = 'OPEN' AND "closedAtMs" IS NULL AND "closeReason" IS NULL)
    OR ("status" <> 'OPEN' AND "closedAtMs" IS NOT NULL AND "closeReason" IS NOT NULL
      AND "closedAtMs" <= "lastObservedAtMs"
      AND (("closeReason" = 'DEADLINE' AND "closedAtMs" = "deadlineAtMs")
        OR ("closeReason" = 'ALL_READY' AND "closedAtMs" >= "openedAtMs" AND "closedAtMs" < "deadlineAtMs"))))
);
ALTER TABLE "PlayerTurnState" ADD CONSTRAINT "valid_player_revision" CHECK (
  "revision" BETWEEN 0 AND 9007199254740991 AND ("active" OR (NOT "ready" AND "revision" = 0))
);
ALTER TABLE "PlayerSubmissionRevision" ADD CONSTRAINT "valid_revision_history" CHECK (
  "revision" BETWEEN 0 AND 9007199254740991 AND jsonb_typeof("orders") = 'array'
  AND (("revision" = 0 AND "kind" = 'INITIAL' AND "command" IS NULL)
    OR ("revision" > 0 AND "kind" <> 'INITIAL' AND "command" IS NOT NULL))
);
ALTER TABLE "PlayerOrder" ADD CONSTRAINT "valid_active_order" CHECK (
  "lastRevision" BETWEEN 1 AND 9007199254740991
  AND jsonb_typeof("payload") = 'object' AND "payload" ? 'orderId' AND "payload" ? 'type'
  AND "payload"->>'orderId' = "orderId" AND upper("payload"->>'type') = "kind"::text
  AND ((NOT "active" AND "draftPosition" IS NULL AND "moveNumber" IS NULL)
    OR ("active" AND "draftPosition" > 0 AND "draftPosition" IS NOT NULL
      AND (("kind" = 'MOVE' AND "moveNumber" > 0 AND "moveNumber" IS NOT NULL)
        OR ("kind" = 'ATTACK' AND "moveNumber" IS NULL))))
);
ALTER TABLE "PlayerOrder" ADD CONSTRAINT "order_content_revision" FOREIGN KEY ("matchId", "turnNumber", "playerId", "lastRevision")
  REFERENCES "PlayerSubmissionRevision" ("matchId", "turnNumber", "playerId", "revision") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "OrderDependency" ADD CONSTRAINT "no_self_dependency" CHECK ("orderId" <> "prerequisiteOrderId");
ALTER TABLE "FrozenTurnInputRecord" ADD CONSTRAINT "valid_resolution_seed" CHECK ("seed" IS NULL OR "seed" BETWEEN 0 AND 4294967295);

CREATE FUNCTION reject_archive_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Immutable record in % cannot be updated', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER fixed_match_configuration BEFORE UPDATE ON "MatchConfiguration" FOR EACH ROW EXECUTE FUNCTION reject_archive_update();
CREATE TRIGGER immutable_snapshot BEFORE UPDATE ON "GameSnapshotRecord" FOR EACH ROW EXECUTE FUNCTION reject_archive_update();
CREATE TRIGGER immutable_revision BEFORE UPDATE ON "PlayerSubmissionRevision" FOR EACH ROW EXECUTE FUNCTION reject_archive_update();
CREATE TRIGGER immutable_resolution BEFORE UPDATE ON "ResolutionResult" FOR EACH ROW EXECUTE FUNCTION reject_archive_update();

CREATE FUNCTION guard_turn_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE duration bigint;
BEGIN
  SELECT "turnDurationMs" INTO STRICT duration FROM "MatchConfiguration" WHERE "matchId" = NEW."matchId";
  IF NEW."deadlineAtMs" - NEW."openedAtMs" <> duration THEN RAISE EXCEPTION 'Turn duration differs from immutable configuration'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'OPEN' THEN RAISE EXCEPTION 'New turns must be open'; END IF;
  ELSE
    IF (NEW."matchId", NEW."number", NEW."startingStateVersion", NEW."openedAtMs", NEW."deadlineAtMs")
      IS DISTINCT FROM (OLD."matchId", OLD."number", OLD."startingStateVersion", OLD."openedAtMs", OLD."deadlineAtMs")
      OR NEW."lastObservedAtMs" < OLD."lastObservedAtMs" THEN RAISE EXCEPTION 'Immutable turn identity/clock changed'; END IF;
    IF NOT (NEW."status" = OLD."status" OR (OLD."status" = 'OPEN' AND NEW."status" = 'CLOSED')
      OR (OLD."status" = 'CLOSED' AND NEW."status" = 'RESOLVING') OR (OLD."status" = 'RESOLVING' AND NEW."status" = 'RESOLVED'))
      THEN RAISE EXCEPTION 'Invalid turn transition'; END IF;
    IF OLD."status" <> 'OPEN' AND (NEW."closedAtMs", NEW."closeReason") IS DISTINCT FROM (OLD."closedAtMs", OLD."closeReason")
      THEN RAISE EXCEPTION 'Turn closure cannot change'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER turn_transition BEFORE INSERT OR UPDATE ON "Turn" FOR EACH ROW EXECUTE FUNCTION guard_turn_transition();

CREATE FUNCTION guard_open_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "Turn" WHERE "matchId" = NEW."matchId" AND "number" = NEW."turnNumber" AND "status" = 'OPEN' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft writes require an open turn'; END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION guard_active_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."active" AND NOT EXISTS (SELECT 1 FROM "PlayerTurnState" WHERE "matchId" = NEW."matchId" AND "turnNumber" = NEW."turnNumber" AND "playerId" = NEW."playerId" AND "active")
    THEN RAISE EXCEPTION 'Active orders require an active turn participant'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER player_draft_guard BEFORE INSERT OR UPDATE ON "PlayerTurnState" FOR EACH ROW EXECUTE FUNCTION guard_open_draft();
CREATE TRIGGER order_draft_guard BEFORE INSERT OR UPDATE ON "PlayerOrder" FOR EACH ROW EXECUTE FUNCTION guard_open_draft();
CREATE TRIGGER active_order_guard BEFORE INSERT OR UPDATE ON "PlayerOrder" FOR EACH ROW EXECUTE FUNCTION guard_active_order();
CREATE TRIGGER revision_draft_guard BEFORE INSERT ON "PlayerSubmissionRevision" FOR EACH ROW EXECUTE FUNCTION guard_open_draft();
CREATE TRIGGER dependency_draft_guard BEFORE INSERT OR UPDATE ON "OrderDependency" FOR EACH ROW EXECUTE FUNCTION guard_open_draft();

CREATE FUNCTION guard_frozen_input() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW."matchId", NEW."turnNumber", NEW."payload", NEW."frozenAt") IS DISTINCT FROM (OLD."matchId", OLD."turnNumber", OLD."payload", OLD."frozenAt")
      OR (OLD."seed" IS NOT NULL AND NEW."seed" IS DISTINCT FROM OLD."seed") THEN RAISE EXCEPTION 'Frozen input and pinned seed are immutable'; END IF;
  ELSE
    PERFORM 1 FROM "Turn" WHERE "matchId" = NEW."matchId" AND "number" = NEW."turnNumber" AND "status" = 'CLOSED';
    IF NOT FOUND THEN RAISE EXCEPTION 'Freeze only a closed turn'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER frozen_input_guard BEFORE INSERT OR UPDATE ON "FrozenTurnInputRecord" FOR EACH ROW EXECUTE FUNCTION guard_frozen_input();

-- Deferred checks allow closure+freeze and result+state advancement to be
-- composed atomically, while rejecting commits that leave half an operation.
CREATE FUNCTION require_turn_archives() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" <> 'OPEN' AND NOT EXISTS (SELECT 1 FROM "FrozenTurnInputRecord" WHERE "matchId" = NEW."matchId" AND "turnNumber" = NEW."number")
    THEN RAISE EXCEPTION 'Closed turn requires frozen input in the same transaction'; END IF;
  IF NEW."status" IN ('RESOLVING', 'RESOLVED') AND NOT EXISTS (SELECT 1 FROM "FrozenTurnInputRecord" WHERE "matchId" = NEW."matchId" AND "turnNumber" = NEW."number" AND "seed" IS NOT NULL)
    THEN RAISE EXCEPTION 'Resolution requires a pinned seed'; END IF;
  IF NEW."status" = 'RESOLVED' AND NOT EXISTS (SELECT 1 FROM "ResolutionResult" WHERE "matchId" = NEW."matchId" AND "turnNumber" = NEW."number")
    THEN RAISE EXCEPTION 'Resolved turn requires a committed result'; END IF;
  IF NEW."closeReason" = 'ALL_READY' AND (NOT EXISTS (SELECT 1 FROM "PlayerTurnState" WHERE "matchId" = NEW."matchId" AND "turnNumber" = NEW."number" AND "active")
    OR EXISTS (SELECT 1 FROM "PlayerTurnState" WHERE "matchId" = NEW."matchId" AND "turnNumber" = NEW."number" AND "active" AND NOT "ready"))
    THEN RAISE EXCEPTION 'Ready closure requires unanimous active readiness'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER turn_archives AFTER INSERT OR UPDATE ON "Turn" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_turn_archives();

COMMIT;
