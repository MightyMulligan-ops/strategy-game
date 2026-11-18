-- Repair1/2, EUROPE107-SQL-ADMISSION-002. Offline authored; fresh hosted CI only.
-- Published migrations are unchanged. Historical guard body is preserved below.
BEGIN;

CREATE OR REPLACE FUNCTION guard_initial_turn_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lifecycle "MatchStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM "id" FROM "Match" WHERE "id" = OLD."matchId" FOR UPDATE;
    IF NOT FOUND THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Configuration cannot be removed while its match exists';
  END IF;
  SELECT "status" INTO STRICT lifecycle FROM "Match" WHERE "id" = NEW."matchId" FOR UPDATE;
  IF NEW."rulesetId" IS NULL AND NEW."rulesetVersion" IS NULL
    AND NEW."simulationVersion" IS NULL AND NEW."pinnedRuleset" IS NULL THEN RETURN NEW; END IF;
  -- EUROPE107-SQL-ADMISSION-002: exact new cohort only, before the v1 guard.
  IF NEW."simulationVersion" = 'europe-playtest-v1' OR NEW."rulesetId" = 'europe-playtest'
    OR NEW."pinnedRuleset"#>>'{ruleset,rulesetId}' = 'europe-playtest'
    OR NEW."pinnedRuleset"->>'simulationVersion' = 'europe-playtest-v1' THEN
    IF NOT europe_loop_profile_ok(NEW) OR lifecycle <> 'OPEN' THEN
      RAISE EXCEPTION 'Europe runtime requires exact metadata and OPEN configuration';
    END IF;
    RETURN NEW;
  END IF;
  IF (jsonb_typeof(NEW."pinnedRuleset") = 'object'
    AND NEW."pinnedRuleset"->'schemaVersion' = '1'::jsonb
    AND NEW."pinnedRuleset"#>>'{ruleset,rulesetId}' = NEW."rulesetId"
    AND NEW."pinnedRuleset"#>>'{ruleset,version}' = NEW."rulesetVersion"
    AND NEW."pinnedRuleset"->>'simulationVersion' = NEW."simulationVersion") IS NOT TRUE THEN
    RAISE EXCEPTION 'Runtime pins must be complete and agree with their metadata';
  END IF;
  IF NEW."simulationVersion" = 'initial-world-v1' OR NEW."rulesetId" = 'initial-world' THEN
    IF NOT initial_turn_profile_ok(NEW) OR lifecycle <> 'OPEN' THEN
      RAISE EXCEPTION 'Initial runtime must be pinned to a valid OPEN configuration';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
