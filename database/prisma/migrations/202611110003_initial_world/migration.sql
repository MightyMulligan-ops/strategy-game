-- Additive only. Existing RUNNING matches are deliberately not backfilled.
BEGIN;
-- CreateTable
CREATE TABLE "MatchWorld" (
    "matchId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "generatorVersion" TEXT NOT NULL,
    "seed" BIGINT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "MatchWorld_pkey" PRIMARY KEY ("matchId")
);

-- AddForeignKey
ALTER TABLE "MatchWorld" ADD CONSTRAINT "MatchWorld_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MatchWorld" ADD CONSTRAINT "initial_world_shape" CHECK (
  ("schemaVersion" = 1 AND "generatorVersion" = 'territory-grid-v1'
    AND "seed" BETWEEN 0 AND 4294967295
    AND jsonb_typeof("payload") = 'object'
    AND "payload"->'schemaVersion' = to_jsonb("schemaVersion")
    AND "payload"->'generatorVersion' = to_jsonb("generatorVersion")
    AND "payload"->'seed' = to_jsonb("seed")
    AND octet_length("payload"::text) <= 2097152) IS TRUE
);

CREATE FUNCTION lock_initial_world_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "id" FROM "Match" WHERE "id" = NEW."matchId" FOR UPDATE;
  RETURN NEW;
END;
$$;
CREATE TRIGGER initial_world_parent_lock BEFORE INSERT ON "MatchWorld"
FOR EACH ROW EXECUTE FUNCTION lock_initial_world_parent();

CREATE FUNCTION guard_initial_world_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only parent-match cascade deletion may remove this immutable archive.
  IF TG_OP = 'DELETE' THEN
    PERFORM "id" FROM "Match" WHERE "id" = OLD."matchId" FOR UPDATE;
    IF NOT FOUND THEN RETURN OLD; END IF;
  END IF;
  RAISE EXCEPTION 'Initial worlds are immutable';
END;
$$;
CREATE TRIGGER fixed_initial_world BEFORE UPDATE OR DELETE ON "MatchWorld"
FOR EACH ROW EXECUTE FUNCTION guard_initial_world_immutable();

CREATE FUNCTION require_committed_initial_world() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id TEXT; lifecycle "MatchStatus";
BEGIN
  IF TG_TABLE_NAME = 'Match' THEN target_id := NEW."id";
  ELSE target_id := NEW."matchId"; END IF;
  SELECT "status" INTO lifecycle FROM "Match" WHERE "id" = target_id;
  -- The whole current-run fixture/match may have been deleted in this transaction.
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF lifecycle <> 'RUNNING' OR NOT EXISTS (SELECT 1 FROM "MatchWorld" WHERE "matchId" = target_id) THEN
    RAISE EXCEPTION 'A newly started match must commit with its initial world';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER started_match_has_world AFTER UPDATE ON "Match"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
WHEN (OLD."status" = 'OPEN' AND NEW."status" = 'RUNNING')
EXECUTE FUNCTION require_committed_initial_world();
CREATE CONSTRAINT TRIGGER initial_world_has_started_match AFTER INSERT ON "MatchWorld"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_committed_initial_world();

COMMIT;
