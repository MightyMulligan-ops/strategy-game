-- Additive v4 draft cohort only. Historical immutable guards remain installed.
-- Authoring only: do not execute without separate owner database authorization.
BEGIN;

CREATE FUNCTION movement_drafts_profile_ok(c "MatchConfiguration") RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT ((c)."schemaVersion" = 1
    AND (c)."rulesetId" = 'movement-drafts' AND (c)."rulesetVersion" = '1'
    AND (c)."simulationVersion" = 'movement-drafts-v1'
    AND (c)."pinnedRuleset" = '{"schemaVersion":1,"ruleset":{"rulesetId":"movement-drafts","version":"1"},"simulationVersion":"movement-drafts-v1","movementTieBreakPolicy":"seeded-shuffle-v1"}'::jsonb
    AND jsonb_typeof((c)."config") = 'object'
    AND (c)."config" - ARRAY['schemaVersion','gameId','turnDurationMs'] = '{}'::jsonb
    AND (c)."config"->'schemaVersion' = '1'::jsonb
    AND (c)."config"->'gameId' = to_jsonb((c)."matchId")
    AND (c)."config"->'turnDurationMs' = to_jsonb((c)."turnDurationMs")) IS TRUE;
$$;

CREATE FUNCTION guard_movement_draft_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lifecycle "MatchStatus";
BEGIN
  IF NEW."simulationVersion" = 'movement-drafts-v1' OR NEW."rulesetId" = 'movement-drafts' THEN
    SELECT "status" INTO STRICT lifecycle FROM "Match" WHERE "id" = NEW."matchId" FOR UPDATE;
    IF NOT movement_drafts_profile_ok(NEW) OR lifecycle <> 'OPEN' THEN RAISE EXCEPTION 'Invalid creation-time draft profile'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movement_draft_configuration BEFORE INSERT ON "MatchConfiguration" FOR EACH ROW EXECUTE FUNCTION guard_movement_draft_configuration();

-- Structural/geographic validation complements application replay of canonical snapshots/IDs.
CREATE FUNCTION movement_draft_queue_ok(key text, actor text, orders jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE s jsonb; w jsonb; f jsonb; o jsonb; x double precision; y double precision; px double precision; py double precision; total double precision := 0;
  -- The exact ECMAScript trim set used by identifier, not locale-dependent regex classes.
  trim_chars CONSTANT text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
  IF jsonb_typeof(orders) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  SELECT "payload" INTO STRICT s FROM "GameSnapshotRecord" WHERE "matchId" = key AND "stateVersion" = 0;
  SELECT "payload" INTO STRICT w FROM "MatchWorld" WHERE "matchId" = key;
  SELECT value INTO STRICT f FROM jsonb_array_elements(s->'formations') WHERE value->>'ownerPlayerId' = actor;
  IF (s->>'kind' = 'movement_drafts' AND s->'schemaVersion' = '4'::jsonb AND jsonb_array_length(f->'unitIds') = 6) IS NOT TRUE THEN RETURN false; END IF;
  IF 6 <> (SELECT count(*) FROM jsonb_array_elements(s->'units') u WHERE u->>'ownerPlayerId' = actor)
    OR 1 <> (SELECT count(*) FROM jsonb_array_elements(s->'units') u WHERE u->>'ownerPlayerId' = actor AND u->>'kind' = 'LEADER' AND u->>'rank' = 'LIEUTENANT' AND u->>'specialization' = 'INFANTRY')
    OR 5 <> (SELECT count(*) FROM jsonb_array_elements(s->'units') u WHERE u->>'ownerPlayerId' = actor AND u->>'kind' = 'INFANTRY') THEN RETURN false; END IF;
  IF jsonb_array_length(orders) <> (SELECT count(DISTINCT entry->>'orderId') FROM jsonb_array_elements(orders) entry) THEN RETURN false; END IF;
  px := (f#>>'{position,x}')::double precision; py := (f#>>'{position,y}')::double precision;
  FOR o IN SELECT value FROM jsonb_array_elements(orders) LOOP
    IF (jsonb_typeof(o) = 'object' AND o - ARRAY['orderId','type','stackId','destination'] = '{}'::jsonb
      AND jsonb_typeof(o->'orderId') = 'string' AND length(o->>'orderId') BETWEEN 1 AND 128 AND btrim(o->>'orderId',trim_chars) = o->>'orderId'
      AND o->>'type' = 'move' AND o->>'stackId' = f->>'formationId'
      AND jsonb_typeof(o->'destination') = 'object' AND (o->'destination') - ARRAY['x','y'] = '{}'::jsonb
      AND jsonb_typeof(o#>'{destination,x}') = 'number' AND jsonb_typeof(o#>'{destination,y}') = 'number') IS NOT TRUE THEN RETURN false; END IF;
    -- Check JSONB's exact numeric values before any binary floating-point conversion.
    IF (o#>>'{destination,x}')::numeric <> trunc((o#>>'{destination,x}')::numeric)
      OR (o#>>'{destination,y}')::numeric <> trunc((o#>>'{destination,y}')::numeric) THEN RETURN false; END IF;
    x := (o#>>'{destination,x}')::double precision; y := (o#>>'{destination,y}')::double precision;
    IF x <> floor(x) OR y <> floor(y) OR x < 0 OR y < 0 OR x > (w#>>'{bounds,width}')::double precision OR y > (w#>>'{bounds,height}')::double precision THEN RETURN false; END IF;
    total := total + sqrt((x-px)*(x-px) + (y-py)*(y-py));
    IF total > 250 THEN RETURN false; END IF;
    px := x; py := y;
  END LOOP;
  RETURN true;
END;
$$;

CREATE FUNCTION guard_movement_draft_artifact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key text; lifecycle "MatchStatus"; c "MatchConfiguration"; t "Turn"; p "PlayerTurnState"; previous jsonb; candidate jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."matchId" IS DISTINCT FROM NEW."matchId" AND EXISTS (SELECT 1 FROM "MatchConfiguration" WHERE "matchId" = OLD."matchId" AND "simulationVersion" = 'movement-drafts-v1') THEN RAISE EXCEPTION 'Draft records cannot change parent'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN key := OLD."matchId"; ELSE key := NEW."matchId"; END IF;
  SELECT "status" INTO lifecycle FROM "Match" WHERE "id" = key FOR UPDATE;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Draft artifact requires its parent';
  END IF;
  SELECT * INTO c FROM "MatchConfiguration" WHERE "matchId" = key;
  IF TG_TABLE_NAME = 'GameSnapshotRecord' AND TG_OP = 'INSERT' THEN
    IF (NEW."payload"->'schemaVersion' = '4'::jsonb OR NEW."payload"->>'kind' = 'movement_drafts' OR NEW."payload"->>'simulationVersion' = 'movement-drafts-v1') IS TRUE
      AND NOT movement_drafts_profile_ok(c) THEN RAISE EXCEPTION 'Draft snapshot requires exact runtime'; END IF;
  END IF;
  IF (c."simulationVersion" = 'movement-drafts-v1') IS NOT TRUE THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
  IF NOT movement_drafts_profile_ok(c) THEN RAISE EXCEPTION 'Invalid draft pins'; END IF;
  IF TG_TABLE_NAME = 'MatchParticipant' THEN
    IF lifecycle <> 'OPEN' THEN RAISE EXCEPTION 'Draft roster is immutable after start'; END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
  IF TG_TABLE_NAME IN ('OrderDependency','FrozenTurnInputRecord','ResolutionResult') THEN RAISE EXCEPTION 'Draft runtime cannot execute lifecycle/gameplay'; END IF;
  IF TG_TABLE_NAME IN ('MatchWorld','GameSnapshotRecord','Turn') THEN
    IF TG_OP <> 'INSERT' OR lifecycle <> 'OPEN' THEN RAISE EXCEPTION 'Initial world, snapshot and turn are immutable'; END IF;
    IF TG_TABLE_NAME = 'GameSnapshotRecord' AND (NEW."stateVersion" = 0 AND NEW."completedTurnNumber" = 0 AND NEW."snapshotId" ~ '^movement-drafts:[a-f0-9]{64}$') IS NOT TRUE THEN RAISE EXCEPTION 'Invalid v4 snapshot'; END IF;
    IF TG_TABLE_NAME = 'Turn' AND (NEW."number" = 1 AND NEW."startingStateVersion" = 0 AND NEW."status" = 'OPEN' AND NEW."lastObservedAtMs" = NEW."openedAtMs" AND NEW."closedAtMs" IS NULL AND NEW."closeReason" IS NULL) IS NOT TRUE THEN RAISE EXCEPTION 'Only immutable OPEN Turn 1 is allowed'; END IF;
    RETURN NEW;
  END IF;
  IF lifecycle = 'OPEN' THEN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Initialization permits inserts only'; END IF;
    IF TG_TABLE_NAME = 'PlayerTurnState' AND (NEW."turnNumber" = 1 AND NEW."active" AND NEW."revision" = 0 AND NOT NEW."ready") IS TRUE THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'PlayerSubmissionRevision' AND (NEW."turnNumber" = 1 AND NEW."revision" = 0 AND NEW."kind" = 'INITIAL' AND NOT NEW."ready" AND NEW."orders" = '[]'::jsonb AND NEW."command" IS NULL) IS TRUE THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Only empty unready revision-zero initialization is allowed';
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Draft/history deletion is prohibited'; END IF;
  SELECT * INTO STRICT t FROM "Turn" WHERE "matchId" = key AND "number" = 1;
  IF (NEW."turnNumber" = 1 AND t."status" = 'OPEN' AND t."lastObservedAtMs" = t."openedAtMs") IS NOT TRUE THEN RAISE EXCEPTION 'Draft turn invariant failed'; END IF;
  IF floor(extract(epoch FROM clock_timestamp())*1000) < t."openedAtMs" OR floor(extract(epoch FROM clock_timestamp())*1000) >= t."deadlineAtMs" THEN
    RAISE EXCEPTION 'Draft acceptance window expired' USING ERRCODE = 'P0051';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."turnNumber",NEW."playerId") IS DISTINCT FROM (OLD."turnNumber",OLD."playerId") THEN RAISE EXCEPTION 'Draft identity is immutable'; END IF;
  SELECT * INTO STRICT p FROM "PlayerTurnState" WHERE "matchId" = key AND "turnNumber" = 1 AND "playerId" = NEW."playerId";
  IF NOT p."active" OR p."ready" THEN RAISE EXCEPTION 'Only active unready drafts may change'; END IF;
  IF TG_TABLE_NAME = 'PlayerTurnState' THEN
    IF TG_OP <> 'UPDATE' OR (NEW."active" AND NOT NEW."ready" AND NEW."revision" = OLD."revision"+1
      AND EXISTS (SELECT 1 FROM "PlayerSubmissionRevision" WHERE "matchId" = key AND "turnNumber" = 1 AND "playerId" = NEW."playerId" AND "revision" = NEW."revision")) IS NOT TRUE THEN RAISE EXCEPTION 'Draft update requires its next immutable history'; END IF;
  ELSIF TG_TABLE_NAME = 'PlayerSubmissionRevision' THEN
    IF TG_OP <> 'INSERT' OR (NEW."revision" = p."revision"+1 AND NOT NEW."ready" AND jsonb_typeof(NEW."command") = 'object'
      AND NEW."command"->'schemaVersion' = '1'::jsonb AND NEW."command"->>'gameId' = key AND NEW."command"->'turnNumber' = '1'::jsonb
      AND NEW."command"->'expectedRevision' = to_jsonb(p."revision") AND movement_draft_queue_ok(key,NEW."playerId",NEW."orders")) IS NOT TRUE THEN RAISE EXCEPTION 'Invalid next draft revision'; END IF;
    SELECT "orders" INTO STRICT previous FROM "PlayerSubmissionRevision" WHERE "matchId" = key AND "turnNumber" = 1 AND "playerId" = NEW."playerId" AND "revision" = p."revision";
    IF NEW."kind" = 'REPLACE_ORDERS' THEN
      IF (NEW."command"->>'kind' = 'replace_orders' AND NEW."command" - ARRAY['schemaVersion','gameId','turnNumber','expectedRevision','kind','orders'] = '{}'::jsonb AND NEW."command"->'orders' = NEW."orders") IS NOT TRUE THEN RAISE EXCEPTION 'Invalid replacement history'; END IF;
    ELSIF NEW."kind" = 'CANCEL_ORDER' THEN
      IF (NEW."command"->>'kind' = 'cancel_order' AND NEW."command" - ARRAY['schemaVersion','gameId','turnNumber','expectedRevision','kind','orderId'] = '{}'::jsonb AND jsonb_typeof(NEW."command"->'orderId') = 'string'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(previous) o WHERE o->>'orderId' = NEW."command"->>'orderId')) IS NOT TRUE THEN RAISE EXCEPTION 'Invalid cancellation history'; END IF;
      SELECT coalesce(jsonb_agg(value ORDER BY ord),'[]'::jsonb) INTO candidate FROM jsonb_array_elements(previous) WITH ORDINALITY e(value,ord) WHERE value->>'orderId' <> NEW."command"->>'orderId';
      IF candidate IS DISTINCT FROM NEW."orders" THEN RAISE EXCEPTION 'Cancellation must preserve remaining queue'; END IF;
    ELSE RAISE EXCEPTION 'Ready/unsupported command prohibited'; END IF;
  ELSIF TG_TABLE_NAME = 'PlayerOrder' THEN
    IF (NEW."kind" = 'MOVE' AND NEW."lastRevision" = p."revision" AND p."revision" > 0 AND NEW."orderId" = NEW."payload"->>'orderId'
      AND movement_draft_queue_ok(key,NEW."playerId",jsonb_build_array(NEW."payload"))
      AND ((NEW."active" AND NEW."draftPosition" > 0 AND NEW."moveNumber" = NEW."draftPosition") OR (NOT NEW."active" AND NEW."draftPosition" IS NULL AND NEW."moveNumber" IS NULL))) IS NOT TRUE THEN RAISE EXCEPTION 'Invalid draft order row'; END IF;
    IF TG_OP = 'INSERT' AND NOT NEW."active" THEN RAISE EXCEPTION 'No unhistorical tombstones'; END IF;
    IF TG_OP = 'UPDATE' THEN
      IF NEW."orderId" IS DISTINCT FROM OLD."orderId" THEN RAISE EXCEPTION 'Stable order identity cannot change'; END IF;
      IF NOT NEW."active" AND (NOT OLD."active" OR NEW."payload" IS DISTINCT FROM OLD."payload" OR NEW."kind" IS DISTINCT FROM OLD."kind" OR OLD."lastRevision" <> p."revision"-1) THEN RAISE EXCEPTION 'Invalid order retirement'; END IF;
    END IF;
  ELSE RAISE EXCEPTION 'Unsupported draft artifact'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER movement_draft_world BEFORE INSERT OR UPDATE OR DELETE ON "MatchWorld" FOR EACH ROW EXECUTE FUNCTION guard_movement_draft_artifact();
CREATE TRIGGER movement_draft_snapshot BEFORE INSERT OR UPDATE OR DELETE ON "GameSnapshotRecord" FOR EACH ROW EXECUTE FUNCTION guard_movement_draft_artifact();
CREATE TRIGGER movement_draft_turn BEFORE INSERT OR UPDATE OR DELETE ON "Turn" FOR EACH ROW EXECUTE FUNCTION guard_movement_draft_artifact();
CREATE TRIGGER movement_draft_player BEFORE INSERT OR UPDATE OR DELETE ON "PlayerTurnState" FOR EACH ROW EXECUTE FUNCTION guard_movement_draft_artifact();
CREATE TRIGGER movement_draft_history BEFORE INSERT OR UPDATE OR DELETE ON "PlayerSubmissionRevision" FOR EACH ROW EXECUTE FUNCTION guard_movement_draft_artifact();
CREATE TRIGGER movement_draft_order BEFORE INSERT OR UPDATE OR DELETE ON "PlayerOrder" FOR EACH ROW EXECUTE FUNCTION guard_movement_draft_artifact();
CREATE TRIGGER movement_draft_dependency BEFORE INSERT OR UPDATE OR DELETE ON "OrderDependency" FOR EACH ROW EXECUTE FUNCTION guard_movement_draft_artifact();
CREATE TRIGGER movement_draft_frozen BEFORE INSERT OR UPDATE OR DELETE ON "FrozenTurnInputRecord" FOR EACH ROW EXECUTE FUNCTION guard_movement_draft_artifact();
CREATE TRIGGER movement_draft_result BEFORE INSERT OR UPDATE OR DELETE ON "ResolutionResult" FOR EACH ROW EXECUTE FUNCTION guard_movement_draft_artifact();
CREATE TRIGGER movement_draft_roster BEFORE INSERT OR UPDATE OR DELETE ON "MatchParticipant" FOR EACH ROW EXECUTE FUNCTION guard_movement_draft_artifact();

CREATE FUNCTION guard_movement_draft_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."currentStateVersion" IS DISTINCT FROM OLD."currentStateVersion"
    AND EXISTS (SELECT 1 FROM "MatchConfiguration" WHERE "matchId" = NEW."id" AND "simulationVersion" = 'movement-drafts-v1') THEN
    RAISE EXCEPTION 'Initial runtime cannot advance simulation state';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movement_draft_match_version BEFORE UPDATE ON "Match" FOR EACH ROW EXECUTE FUNCTION guard_movement_draft_version();

CREATE OR REPLACE FUNCTION require_initial_turn_bundle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key text; m "Match"; c "MatchConfiguration"; w "MatchWorld"; s "GameSnapshotRecord"; t "Turn"; n integer;
BEGIN
  IF TG_TABLE_NAME = 'Match' THEN key := NEW."id"; ELSE key := NEW."matchId"; END IF;
  SELECT * INTO m FROM "Match" WHERE "id" = key;
  IF NOT FOUND THEN RETURN NULL; END IF; -- Only complete parent-match cascade cleanup.
  SELECT * INTO c FROM "MatchConfiguration" WHERE "matchId" = key;
  IF TG_TABLE_NAME = 'Match' AND (c."matchId" IS NULL OR NOT (
    (c."rulesetId" IS NULL AND c."rulesetVersion" IS NULL AND c."simulationVersion" IS NULL AND c."pinnedRuleset" IS NULL)
    OR initial_turn_profile_ok(c) OR initial_armies_profile_ok(c) OR movement_drafts_profile_ok(c))) THEN RAISE EXCEPTION 'Unsupported lobby start runtime'; END IF;
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

CREATE FUNCTION require_initial_movement_bundle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key text; m "Match"; c "MatchConfiguration"; w "MatchWorld"; s "GameSnapshotRecord"; t "Turn"; n integer; f jsonb; u jsonb; capital jsonb; source jsonb; member text;
BEGIN
  IF TG_TABLE_NAME = 'Match' THEN key := NEW."id"; ELSE key := NEW."matchId"; END IF;
  SELECT * INTO m FROM "Match" WHERE "id" = key;
  IF NOT FOUND THEN RETURN NULL; END IF; -- Only complete parent-match cascade cleanup.
  SELECT * INTO c FROM "MatchConfiguration" WHERE "matchId" = key;
  IF (c."simulationVersion" = 'movement-drafts-v1') IS NOT TRUE THEN RETURN NULL; END IF;
  IF m."status" <> 'RUNNING' OR m."currentStateVersion" <> 0 OR NOT movement_drafts_profile_ok(c) THEN
    RAISE EXCEPTION 'Initial artifacts must commit atomically with a supported RUNNING match';
  END IF;
  SELECT * INTO w FROM "MatchWorld" WHERE "matchId" = key;
  IF NOT FOUND THEN RAISE EXCEPTION 'Initial turn requires its world archive'; END IF;
  SELECT * INTO s FROM "GameSnapshotRecord" WHERE "matchId" = key AND "stateVersion" = 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'Initial turn requires its snapshot'; END IF;
  SELECT * INTO t FROM "Turn" WHERE "matchId" = key AND "number" = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Initial snapshot requires Turn 1'; END IF;
  IF (jsonb_typeof(s."payload") = 'object'
    AND s."payload" - ARRAY['schemaVersion','kind','snapshotId','ruleset','simulationVersion','config','completedTurnNumber','stateVersion','players','worldRef','policy','units','formations','initialArmiesSnapshotId'] = '{}'::jsonb
    AND s."payload"->'schemaVersion' = '4'::jsonb AND s."payload"->>'kind' = 'movement_drafts'
    AND s."payload"->'snapshotId' = to_jsonb(s."snapshotId") AND s."snapshotId" ~ '^movement-drafts:[a-f0-9]{64}$'
    AND s."payload"->>'initialArmiesSnapshotId' ~ '^initial-armies:[a-f0-9]{64}$'
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
  -- Structural/lifecycle/reference integrity here; canonical hashes/IDs are replayed
  -- from the actual archive in the application. Digest-shaped strings are not proof.
  IF (jsonb_typeof(s."payload"->'units') = 'array'
    AND jsonb_typeof(s."payload"->'formations') = 'array'
    AND s."payload"->'policy' = '{"schemaVersion":1,"armyVersion":"initial-armies-v1","movementVersion":"starting-foot-v1","rangePerTurn":250,"budget":"cumulative","leaderlessRadius":null}'::jsonb
    AND jsonb_typeof(w."payload"#>'{startingState,cities}') = 'array'
    AND jsonb_typeof(w."payload"#>'{startingState,resourceNodes}') = 'array'
    AND w."payload"#>'{startingState,units}' = '[]'::jsonb) IS NOT TRUE THEN
    RAISE EXCEPTION 'Invalid army policy or archive contract';
  END IF;
  IF jsonb_array_length(s."payload"->'units') <> 6*n
    OR jsonb_array_length(s."payload"->'formations') <> n
    OR n <> (SELECT count(DISTINCT x->>'ownerPlayerId') FROM jsonb_array_elements(s."payload"->'formations') x)
    OR n <> (SELECT count(DISTINCT x->>'formationId') FROM jsonb_array_elements(s."payload"->'formations') x)
    OR 6*n <> (SELECT count(DISTINCT x->>'unitId') FROM jsonb_array_elements(s."payload"->'units') x) THEN
    RAISE EXCEPTION 'Army identities, membership or counts disagree';
  END IF;
  FOR u IN SELECT value FROM jsonb_array_elements(s."payload"->'units') LOOP
    IF (jsonb_typeof(u) = 'object' AND u->'schemaVersion' = '1'::jsonb
      AND u->>'unitId' ~ '^unit:[a-f0-9]{64}$'
      AND jsonb_typeof(u->'ownerPlayerId') = 'string'
      AND jsonb_typeof(u->'originalSpawnNodeId') = 'string'
      AND EXISTS (SELECT 1 FROM "MatchParticipant" WHERE "matchId" = key AND "active" AND "playerId" = u->>'ownerPlayerId')
      AND ((u->>'kind' = 'INFANTRY' AND u - ARRAY['schemaVersion','unitId','ownerPlayerId','kind','originalSpawnNodeId'] = '{}'::jsonb)
        OR (u->>'kind' = 'LEADER' AND u->>'rank' = 'LIEUTENANT' AND u->>'specialization' = 'INFANTRY'
          AND u - ARRAY['schemaVersion','unitId','ownerPlayerId','kind','originalSpawnNodeId','rank','specialization'] = '{}'::jsonb))) IS NOT TRUE THEN
      RAISE EXCEPTION 'Invalid authoritative starting unit';
    END IF;
  END LOOP;
  FOR f IN SELECT value FROM jsonb_array_elements(s."payload"->'formations') LOOP
    IF (jsonb_typeof(f) = 'object' AND f->'schemaVersion' = '1'::jsonb
      AND f - ARRAY['schemaVersion','formationId','ownerPlayerId','unitIds','position'] = '{}'::jsonb
      AND f->>'formationId' ~ '^formation:[a-f0-9]{64}$'
      AND jsonb_typeof(f->'ownerPlayerId') = 'string' AND jsonb_typeof(f->'unitIds') = 'array') IS NOT TRUE THEN
      RAISE EXCEPTION 'Invalid authoritative formation';
    END IF;
    IF jsonb_array_length(f->'unitIds') <> 6
      OR 6 <> (SELECT count(DISTINCT x #>> '{}') FROM jsonb_array_elements(f->'unitIds') x)
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(f->'unitIds') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'string')
      OR 6 <> (SELECT count(*) FROM jsonb_array_elements(s."payload"->'units') x WHERE x->>'ownerPlayerId' = f->>'ownerPlayerId')
      OR 1 <> (SELECT count(*) FROM jsonb_array_elements(s."payload"->'units') x WHERE x->>'ownerPlayerId' = f->>'ownerPlayerId' AND x->>'kind' = 'LEADER')
      OR 5 <> (SELECT count(*) FROM jsonb_array_elements(s."payload"->'units') x WHERE x->>'ownerPlayerId' = f->>'ownerPlayerId' AND x->>'kind' = 'INFANTRY') THEN
      RAISE EXCEPTION 'Formation requires exactly its Lieutenant and five Infantry';
    END IF;
    SELECT value INTO STRICT capital FROM jsonb_array_elements(w."payload"#>'{startingState,cities}')
      WHERE value->>'ownerPlayerId' = f->>'ownerPlayerId' AND value->>'kind' = 'CAPITAL';
    SELECT value INTO STRICT source FROM jsonb_array_elements(w."payload"#>'{startingState,resourceNodes}')
      WHERE value->>'ownerPlayerId' = f->>'ownerPlayerId' AND value->>'cityId' = capital->>'cityId' AND value->>'kind' = 'MILITARY_SUPPLIES';
    IF (f->'position' = capital->'position') IS NOT TRUE THEN RAISE EXCEPTION 'Formation must be at its existing capital'; END IF;
    FOR member IN SELECT value #>> '{}' FROM jsonb_array_elements(f->'unitIds') LOOP
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s."payload"->'units') x
        WHERE x->>'unitId' = member AND x->>'ownerPlayerId' = f->>'ownerPlayerId' AND x->>'originalSpawnNodeId' = source->>'nodeId') THEN
        RAISE EXCEPTION 'Formation membership, owner or original spawn reference disagrees';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE FUNCTION require_movement_draft_bundle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "PlayerTurnState"; c "MatchConfiguration"; r "PlayerSubmissionRevision"; seq bigint := 0; last_orders jsonb := '[]'::jsonb; actual jsonb; candidate jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Match" WHERE "id" = NEW."matchId") THEN RETURN NULL; END IF;
  SELECT * INTO c FROM "MatchConfiguration" WHERE "matchId" = NEW."matchId";
  IF (c."simulationVersion" = 'movement-drafts-v1') IS NOT TRUE THEN RETURN NULL; END IF;
  IF NOT movement_drafts_profile_ok(c) THEN RAISE EXCEPTION 'Invalid draft bundle profile'; END IF;
  SELECT * INTO STRICT p FROM "PlayerTurnState" WHERE "matchId" = NEW."matchId" AND "turnNumber" = 1 AND "playerId" = NEW."playerId";
  IF NOT p."active" OR p."ready" OR p."turnNumber" <> 1 THEN RAISE EXCEPTION 'Draft must remain active/unready'; END IF;
  FOR r IN SELECT * FROM "PlayerSubmissionRevision" WHERE "matchId" = p."matchId" AND "turnNumber" = 1 AND "playerId" = p."playerId" ORDER BY "revision" LOOP
    IF r."revision" <> seq OR r."ready" OR NOT movement_draft_queue_ok(p."matchId",p."playerId",r."orders") THEN RAISE EXCEPTION 'Draft history gap or invalid queue'; END IF;
    IF seq = 0 THEN
      IF r."kind" <> 'INITIAL' OR r."orders" <> '[]'::jsonb OR r."command" IS NOT NULL THEN RAISE EXCEPTION 'Invalid initial draft history'; END IF;
    ELSE
      IF (r."command"->'expectedRevision' = to_jsonb(seq-1) AND r."command"->>'gameId' = p."matchId" AND r."command"->'turnNumber' = '1'::jsonb) IS NOT TRUE THEN RAISE EXCEPTION 'History scope/revision mismatch'; END IF;
      IF r."kind" = 'REPLACE_ORDERS' THEN candidate := r."command"->'orders';
      ELSIF r."kind" = 'CANCEL_ORDER' THEN
        IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(last_orders) o WHERE o->>'orderId' = r."command"->>'orderId') THEN RAISE EXCEPTION 'Missing cancellation identity'; END IF;
        SELECT coalesce(jsonb_agg(value ORDER BY ord),'[]'::jsonb) INTO candidate FROM jsonb_array_elements(last_orders) WITH ORDINALITY e(value,ord) WHERE value->>'orderId' <> r."command"->>'orderId';
      ELSE RAISE EXCEPTION 'Unsupported history kind'; END IF;
      IF candidate IS DISTINCT FROM r."orders" THEN RAISE EXCEPTION 'History cannot reconstruct accepted draft'; END IF;
    END IF;
    last_orders := r."orders"; seq := seq+1;
  END LOOP;
  IF seq <> p."revision"+1 THEN RAISE EXCEPTION 'Draft revision requires complete history'; END IF;
  SELECT coalesce(jsonb_agg("payload" ORDER BY "draftPosition"),'[]'::jsonb) INTO actual FROM "PlayerOrder" WHERE "matchId" = p."matchId" AND "turnNumber" = 1 AND "playerId" = p."playerId" AND "active";
  IF actual IS DISTINCT FROM last_orders THEN RAISE EXCEPTION 'Active orders and latest history disagree'; END IF;
  IF EXISTS (SELECT 1 FROM (SELECT "draftPosition","moveNumber","lastRevision",row_number() OVER (ORDER BY "draftPosition") AS n FROM "PlayerOrder" WHERE "matchId" = p."matchId" AND "turnNumber" = 1 AND "playerId" = p."playerId" AND "active") q WHERE q."draftPosition" <> q.n OR q."moveNumber" <> q.n OR q."lastRevision" <> p."revision")
    OR EXISTS (SELECT 1 FROM "PlayerOrder" WHERE "matchId" = p."matchId" AND "turnNumber" = 1 AND "playerId" = p."playerId" AND ("lastRevision" < 1 OR "lastRevision" > p."revision" OR "kind" <> 'MOVE')) THEN RAISE EXCEPTION 'Draft numbering or row revision inconsistent'; END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER movement_draft_complete_player AFTER INSERT OR UPDATE ON "PlayerTurnState" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_movement_draft_bundle();
CREATE CONSTRAINT TRIGGER movement_draft_complete_history AFTER INSERT OR UPDATE ON "PlayerSubmissionRevision" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_movement_draft_bundle();
CREATE CONSTRAINT TRIGGER movement_draft_complete_order AFTER INSERT OR UPDATE ON "PlayerOrder" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_movement_draft_bundle();

CREATE CONSTRAINT TRIGGER movement_draft_started AFTER UPDATE ON "Match" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD."status" = 'OPEN' AND NEW."status" = 'RUNNING') EXECUTE FUNCTION require_initial_movement_bundle();
CREATE CONSTRAINT TRIGGER movement_draft_initial_world AFTER INSERT ON "MatchWorld" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_initial_movement_bundle();
CREATE CONSTRAINT TRIGGER movement_draft_initial_snapshot AFTER INSERT ON "GameSnapshotRecord" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_initial_movement_bundle();
CREATE CONSTRAINT TRIGGER movement_draft_initial_turn AFTER INSERT ON "Turn" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_initial_movement_bundle();

CREATE FUNCTION delete_movement_draft_children() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "MatchConfiguration" WHERE "matchId" = OLD."id" AND "simulationVersion" = 'movement-drafts-v1') THEN
    DELETE FROM "PlayerSubmissionRevision" WHERE "matchId" = OLD."id";
    DELETE FROM "PlayerTurnState" WHERE "matchId" = OLD."id";
    DELETE FROM "Turn" WHERE "matchId" = OLD."id";
    DELETE FROM "GameSnapshotRecord" WHERE "matchId" = OLD."id";
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER "A_movement_draft_cascade" AFTER DELETE ON "Match" FOR EACH ROW EXECUTE FUNCTION delete_movement_draft_children();

COMMIT;
