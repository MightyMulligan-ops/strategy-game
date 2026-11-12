-- Additive guards only: no table/data rewrite, backfill, extension or previous-migration edit.
-- Existing all-NULL runtime configurations retain legacy world-only behavior.
BEGIN;

CREATE FUNCTION initial_turn_profile_ok(c "MatchConfiguration") RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT ((c)."schemaVersion" = 1
    AND (c)."rulesetId" = 'initial-world' AND (c)."rulesetVersion" = '1'
    AND (c)."simulationVersion" = 'initial-world-v1'
    AND (c)."pinnedRuleset" = '{"schemaVersion":1,"ruleset":{"rulesetId":"initial-world","version":"1"},"simulationVersion":"initial-world-v1","movementTieBreakPolicy":"seeded-shuffle-v1"}'::jsonb
    AND jsonb_typeof((c)."config") = 'object'
    AND (c)."config" - ARRAY['schemaVersion','gameId','turnDurationMs'] = '{}'::jsonb
    AND (c)."config"->'schemaVersion' = '1'::jsonb
    AND (c)."config"->'gameId' = to_jsonb((c)."matchId")
    AND (c)."config"->'turnDurationMs' = to_jsonb((c)."turnDurationMs")) IS TRUE;
$$;

CREATE FUNCTION guard_initial_turn_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER initial_turn_configuration BEFORE INSERT OR DELETE ON "MatchConfiguration"
FOR EACH ROW EXECUTE FUNCTION guard_initial_turn_configuration();

CREATE FUNCTION guard_initial_turn_artifact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key text; lifecycle "MatchStatus"; c "MatchConfiguration"; initial boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN key := OLD."matchId"; ELSE key := NEW."matchId"; END IF;
  SELECT "status" INTO lifecycle FROM "Match" WHERE "id" = key FOR UPDATE;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Initialization requires an existing parent match';
  END IF;
  SELECT * INTO c FROM "MatchConfiguration" WHERE "matchId" = key;
  initial := (c."simulationVersion" = 'initial-world-v1') IS TRUE;
  IF TG_TABLE_NAME = 'MatchWorld' AND TG_OP = 'INSERT' AND lifecycle <> 'OPEN' THEN
    RAISE EXCEPTION 'RUNNING worlds must never be initialized';
  END IF;
  IF TG_OP = 'INSERT' AND lifecycle = 'RUNNING' AND TG_TABLE_NAME IN ('GameSnapshotRecord','Turn','PlayerTurnState','PlayerSubmissionRevision')
    AND c."rulesetId" IS NULL AND c."rulesetVersion" IS NULL AND c."simulationVersion" IS NULL AND c."pinnedRuleset" IS NULL THEN
    RAISE EXCEPTION 'Unpinned RUNNING matches must never be initialized';
  END IF;
  IF TG_TABLE_NAME = 'GameSnapshotRecord' AND TG_OP = 'INSERT' THEN
    IF (NEW."payload"->'schemaVersion' = '2'::jsonb OR NEW."payload"->>'kind' = 'initial_world'
      OR NEW."payload"->>'simulationVersion' = 'initial-world-v1') IS TRUE AND NOT initial THEN
      RAISE EXCEPTION 'Initial snapshot requires its exact runtime profile';
    END IF;
  END IF;
  IF NOT initial THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF NOT initial_turn_profile_ok(c) THEN RAISE EXCEPTION 'Invalid initial runtime profile'; END IF;
  IF TG_TABLE_NAME = 'MatchParticipant' THEN
    IF lifecycle <> 'OPEN' THEN RAISE EXCEPTION 'Initial match roster is fixed after start'; END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP <> 'INSERT' OR lifecycle <> 'OPEN' THEN
    RAISE EXCEPTION 'Initial turn records are immutable and cannot be backfilled';
  END IF;
  IF TG_TABLE_NAME IN ('PlayerOrder','OrderDependency','FrozenTurnInputRecord','ResolutionResult') THEN
    RAISE EXCEPTION 'Initial runtime supports initialization only';
  END IF;
  IF TG_TABLE_NAME = 'GameSnapshotRecord' THEN
    IF (NEW."stateVersion" = 0 AND NEW."completedTurnNumber" = 0
      AND NEW."snapshotId" ~ '^initial-world:[a-f0-9]{64}$') IS NOT TRUE THEN
      RAISE EXCEPTION 'Invalid initial snapshot metadata';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'Turn' THEN
    IF (NEW."number" = 1 AND NEW."startingStateVersion" = 0 AND NEW."status" = 'OPEN'
      AND NEW."lastObservedAtMs" = NEW."openedAtMs" AND NEW."closedAtMs" IS NULL AND NEW."closeReason" IS NULL) IS NOT TRUE THEN
      RAISE EXCEPTION 'Invalid initial turn metadata';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'PlayerTurnState' THEN
    IF (NEW."turnNumber" = 1 AND NEW."active" AND NEW."revision" = 0 AND NOT NEW."ready") IS NOT TRUE THEN
      RAISE EXCEPTION 'Initial drafts must be active, empty, revision zero and unready';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'PlayerSubmissionRevision' THEN
    IF (NEW."turnNumber" = 1 AND NEW."revision" = 0 AND NEW."kind" = 'INITIAL'
      AND NOT NEW."ready" AND NEW."orders" = '[]'::jsonb AND NEW."command" IS NULL) IS NOT TRUE THEN
      RAISE EXCEPTION 'Invalid initial revision history';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER initial_turn_world BEFORE INSERT ON "MatchWorld" FOR EACH ROW EXECUTE FUNCTION guard_initial_turn_artifact();
CREATE TRIGGER initial_turn_snapshot BEFORE INSERT OR UPDATE OR DELETE ON "GameSnapshotRecord" FOR EACH ROW EXECUTE FUNCTION guard_initial_turn_artifact();
CREATE TRIGGER initial_turn_record BEFORE INSERT OR UPDATE OR DELETE ON "Turn" FOR EACH ROW EXECUTE FUNCTION guard_initial_turn_artifact();
CREATE TRIGGER initial_turn_player BEFORE INSERT OR UPDATE OR DELETE ON "PlayerTurnState" FOR EACH ROW EXECUTE FUNCTION guard_initial_turn_artifact();
CREATE TRIGGER initial_turn_revision BEFORE INSERT OR UPDATE OR DELETE ON "PlayerSubmissionRevision" FOR EACH ROW EXECUTE FUNCTION guard_initial_turn_artifact();
CREATE TRIGGER initial_turn_order BEFORE INSERT OR UPDATE OR DELETE ON "PlayerOrder" FOR EACH ROW EXECUTE FUNCTION guard_initial_turn_artifact();
CREATE TRIGGER initial_turn_dependency BEFORE INSERT OR UPDATE OR DELETE ON "OrderDependency" FOR EACH ROW EXECUTE FUNCTION guard_initial_turn_artifact();
CREATE TRIGGER initial_turn_frozen BEFORE INSERT OR UPDATE OR DELETE ON "FrozenTurnInputRecord" FOR EACH ROW EXECUTE FUNCTION guard_initial_turn_artifact();
CREATE TRIGGER initial_turn_result BEFORE INSERT OR UPDATE OR DELETE ON "ResolutionResult" FOR EACH ROW EXECUTE FUNCTION guard_initial_turn_artifact();
CREATE TRIGGER initial_turn_roster BEFORE INSERT OR UPDATE OR DELETE ON "MatchParticipant" FOR EACH ROW EXECUTE FUNCTION guard_initial_turn_artifact();

CREATE FUNCTION guard_initial_match_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."currentStateVersion" IS DISTINCT FROM OLD."currentStateVersion"
    AND EXISTS (SELECT 1 FROM "MatchConfiguration" WHERE "matchId" = NEW."id" AND "simulationVersion" = 'initial-world-v1') THEN
    RAISE EXCEPTION 'Initial runtime cannot advance simulation state';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER initial_turn_match_version BEFORE UPDATE ON "Match" FOR EACH ROW EXECUTE FUNCTION guard_initial_match_version();

CREATE FUNCTION require_initial_turn_bundle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key text; m "Match"; c "MatchConfiguration"; w "MatchWorld"; s "GameSnapshotRecord"; t "Turn"; n integer;
BEGIN
  IF TG_TABLE_NAME = 'Match' THEN key := NEW."id"; ELSE key := NEW."matchId"; END IF;
  SELECT * INTO m FROM "Match" WHERE "id" = key;
  IF NOT FOUND THEN RETURN NULL; END IF; -- Only complete parent-match cascade cleanup.
  SELECT * INTO c FROM "MatchConfiguration" WHERE "matchId" = key;
  IF TG_TABLE_NAME = 'Match' AND (c."matchId" IS NULL OR NOT (
    (c."rulesetId" IS NULL AND c."rulesetVersion" IS NULL AND c."simulationVersion" IS NULL AND c."pinnedRuleset" IS NULL)
    OR initial_turn_profile_ok(c))) THEN RAISE EXCEPTION 'Unsupported lobby start runtime'; END IF;
  IF (c."simulationVersion" = 'initial-world-v1') IS NOT TRUE THEN RETURN NULL; END IF;
  IF m."status" <> 'RUNNING' OR m."currentStateVersion" <> 0 OR NOT initial_turn_profile_ok(c) THEN
    RAISE EXCEPTION 'Initial artifacts must commit atomically with a supported RUNNING match';
  END IF;
  SELECT * INTO w FROM "MatchWorld" WHERE "matchId" = key;
  IF NOT FOUND THEN RAISE EXCEPTION 'Initial turn requires its world archive'; END IF;
  SELECT * INTO s FROM "GameSnapshotRecord" WHERE "matchId" = key AND "stateVersion" = 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'Initial turn requires its snapshot'; END IF;
  SELECT * INTO t FROM "Turn" WHERE "matchId" = key AND "number" = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Initial snapshot requires Turn 1'; END IF;
  IF (jsonb_typeof(s."payload") = 'object'
    AND s."payload" - ARRAY['schemaVersion','kind','snapshotId','ruleset','simulationVersion','config','completedTurnNumber','stateVersion','players','worldRef'] = '{}'::jsonb
    AND s."payload"->'schemaVersion' = '2'::jsonb AND s."payload"->>'kind' = 'initial_world'
    AND s."payload"->'snapshotId' = to_jsonb(s."snapshotId") AND s."snapshotId" ~ '^initial-world:[a-f0-9]{64}$'
    AND s."completedTurnNumber" = 0 AND s."payload"->'completedTurnNumber' = '0'::jsonb AND s."payload"->'stateVersion' = '0'::jsonb
    AND s."payload"->'config' = c."config" AND s."payload"->'ruleset' = c."pinnedRuleset"->'ruleset'
    AND s."payload"->>'simulationVersion' = c."simulationVersion"
    AND jsonb_typeof(s."payload"->'worldRef') = 'object'
    AND (s."payload"->'worldRef') - ARRAY['matchId','archiveSchemaVersion','generatorVersion','digest'] = '{}'::jsonb
    AND s."payload"#>>'{worldRef,matchId}' = key
    AND s."payload"#>'{worldRef,archiveSchemaVersion}' = to_jsonb(w."schemaVersion")
    AND s."payload"#>>'{worldRef,generatorVersion}' = w."generatorVersion"
    AND s."payload"#>>'{worldRef,digest}' ~ '^sha256:[a-f0-9]{64}$'
    AND t."startingStateVersion" = 0 AND t."status" = 'OPEN' AND t."lastObservedAtMs" = t."openedAtMs"
    AND t."deadlineAtMs" - t."openedAtMs" = c."turnDurationMs" AND t."closedAtMs" IS NULL AND t."closeReason" IS NULL
    AND jsonb_typeof(s."payload"->'players') = 'array'
    AND jsonb_typeof(w."payload"->'players') = 'array'
    AND w."payload"#>'{settings,regionSide}' = '5'::jsonb) IS NOT TRUE THEN
    RAISE EXCEPTION 'Initial snapshot, archive, configuration and turn metadata disagree';
  END IF;
  n := jsonb_array_length(s."payload"->'players');
  IF n < 2 OR n > 40 OR n <> (SELECT count(*) FROM "MatchParticipant" WHERE "matchId" = key AND "active")
    OR n <> jsonb_array_length(w."payload"->'players')
    OR n <> (SELECT count(DISTINCT p #>> '{}') FROM jsonb_array_elements(w."payload"->'players') p)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(w."payload"->'players') p WHERE jsonb_typeof(p) IS DISTINCT FROM 'string')
    OR EXISTS ((SELECT p #>> '{}' FROM jsonb_array_elements(w."payload"->'players') p)
      EXCEPT (SELECT "playerId" FROM "MatchParticipant" WHERE "matchId" = key AND "active"))
    OR n <> (SELECT count(DISTINCT p->>'playerId') FROM jsonb_array_elements(s."payload"->'players') p)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(s."payload"->'players') p WHERE
      (jsonb_typeof(p) = 'object' AND p - ARRAY['schemaVersion','gameId','playerId','active'] = '{}'::jsonb
        AND p->'schemaVersion' = '1'::jsonb AND p->>'gameId' = key AND p->'active' = 'true'::jsonb
        AND jsonb_typeof(p->'playerId') = 'string') IS NOT TRUE)
    OR EXISTS ((SELECT p->>'playerId' FROM jsonb_array_elements(s."payload"->'players') p)
      EXCEPT (SELECT "playerId" FROM "MatchParticipant" WHERE "matchId" = key AND "active"))
    OR n <> (SELECT count(*) FROM "PlayerTurnState" WHERE "matchId" = key AND "turnNumber" = 1)
    OR EXISTS ((SELECT "playerId" FROM "PlayerTurnState" WHERE "matchId" = key AND "turnNumber" = 1)
      EXCEPT (SELECT "playerId" FROM "MatchParticipant" WHERE "matchId" = key AND "active"))
    OR EXISTS (SELECT 1 FROM "PlayerTurnState" WHERE "matchId" = key AND ("turnNumber" <> 1 OR NOT "active" OR "revision" <> 0 OR "ready"))
    OR n <> (SELECT count(*) FROM "PlayerSubmissionRevision" WHERE "matchId" = key)
    OR EXISTS (SELECT 1 FROM "PlayerSubmissionRevision" WHERE "matchId" = key AND
      ("turnNumber" = 1 AND "revision" = 0 AND "kind" = 'INITIAL' AND NOT "ready" AND "orders" = '[]'::jsonb AND "command" IS NULL) IS NOT TRUE)
    OR EXISTS (SELECT 1 FROM "PlayerOrder" WHERE "matchId" = key)
    OR EXISTS (SELECT 1 FROM "FrozenTurnInputRecord" WHERE "matchId" = key)
    OR EXISTS (SELECT 1 FROM "ResolutionResult" WHERE "matchId" = key) THEN
    RAISE EXCEPTION 'Initial turn requires the exact active roster and empty revision-zero history';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER initial_turn_started AFTER UPDATE ON "Match" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (OLD."status" = 'OPEN' AND NEW."status" = 'RUNNING') EXECUTE FUNCTION require_initial_turn_bundle();
CREATE CONSTRAINT TRIGGER initial_turn_world_complete AFTER INSERT ON "MatchWorld" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_initial_turn_bundle();
CREATE CONSTRAINT TRIGGER initial_turn_snapshot_complete AFTER INSERT ON "GameSnapshotRecord" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_initial_turn_bundle();
CREATE CONSTRAINT TRIGGER initial_turn_record_complete AFTER INSERT ON "Turn" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_initial_turn_bundle();
-- Player/history rows can only be inserted while OPEN, in the same transaction as
-- their required Turn/Snapshot and OPEN->RUNNING events. Those events check the
-- whole bundle, avoiding O(players) repeated completeness scans at commit.

COMMIT;
