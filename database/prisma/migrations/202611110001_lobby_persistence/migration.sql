-- Reviewed additive migration. No records are deleted, merged, or re-created.
BEGIN;

-- Stop membership writers while checking legacy data and installing uniqueness.
LOCK TABLE "Match", "MatchConfiguration", "MatchParticipant" IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "MatchParticipant" GROUP BY "matchId", "identityId" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Lobby migration blocked: duplicate (matchId, identityId) memberships. Review conflicts manually; no records have been changed.';
  END IF;
END;
$$;

CREATE TYPE "MatchStatus" AS ENUM ('OPEN', 'RUNNING');

-- RUNNING classifies existing internal matches. Historical hosts, creation
-- timestamps, names, and capacities remain unknown (NULL), never fabricated.
ALTER TABLE "Match" ADD COLUMN "createdAt" TIMESTAMPTZ(3),
ADD COLUMN "hostIdentityId" TEXT,
ADD COLUMN "status" "MatchStatus" NOT NULL DEFAULT 'RUNNING';

-- A lobby has fixed duration/config but no world or pinned simulation yet.
-- Preserve all existing runtime pins; permit their complete absence only for
-- new lobby configurations. Do not replace the existing immutability trigger.
ALTER TABLE "MatchConfiguration" ADD COLUMN "name" TEXT,
ADD COLUMN "playerCapacity" INTEGER,
ALTER COLUMN "rulesetId" DROP NOT NULL,
ALTER COLUMN "rulesetVersion" DROP NOT NULL,
ALTER COLUMN "simulationVersion" DROP NOT NULL,
ALTER COLUMN "pinnedRuleset" DROP NOT NULL;

CREATE UNIQUE INDEX "MatchParticipant_matchId_identityId_key" ON "MatchParticipant"("matchId", "identityId");
ALTER TABLE "Match" ADD CONSTRAINT "Match_hostIdentityId_fkey" FOREIGN KEY ("hostIdentityId") REFERENCES "PlayerIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Match" ADD CONSTRAINT "lobby_creation_metadata" CHECK (
  ("hostIdentityId" IS NULL AND "createdAt" IS NULL AND "status" = 'RUNNING') OR
  ("hostIdentityId" IS NOT NULL AND "createdAt" IS NOT NULL)
);
ALTER TABLE "MatchConfiguration" ADD CONSTRAINT "lobby_settings_shape" CHECK (
  ("name" IS NULL AND "playerCapacity" IS NULL) OR
  ("name" IS NOT NULL AND length(btrim("name")) > 0 AND "name" = btrim("name")
    AND "playerCapacity" IS NOT NULL AND "playerCapacity" BETWEEN 2 AND 40)
);
ALTER TABLE "MatchConfiguration" ADD CONSTRAINT "complete_runtime_pins" CHECK (
  ("rulesetId" IS NOT NULL AND "rulesetVersion" IS NOT NULL AND "simulationVersion" IS NOT NULL
    AND "pinnedRuleset" IS NOT NULL AND "pinnedRuleset" <> 'null'::jsonb) OR
  ("name" IS NOT NULL AND "playerCapacity" IS NOT NULL AND "rulesetId" IS NULL
    AND "rulesetVersion" IS NULL AND "simulationVersion" IS NULL AND "pinnedRuleset" IS NULL)
);

CREATE FUNCTION guard_lobby_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."hostIdentityId", NEW."createdAt") IS DISTINCT FROM (OLD."hostIdentityId", OLD."createdAt") THEN
    RAISE EXCEPTION 'Lobby host and creation metadata are immutable';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (OLD."status" = 'OPEN' AND NEW."status" = 'RUNNING') THEN
    RAISE EXCEPTION 'Invalid match lifecycle transition';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fixed_lobby_metadata BEFORE UPDATE ON "Match" FOR EACH ROW EXECUTE FUNCTION guard_lobby_metadata();

COMMIT;
