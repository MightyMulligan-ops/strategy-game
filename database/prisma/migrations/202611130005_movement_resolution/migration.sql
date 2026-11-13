-- Additive v6/v7 movement cohort only. No records are rewritten or upgraded.
BEGIN;
CREATE FUNCTION movement_resolution_profile_ok(c "MatchConfiguration") RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT ((c)."schemaVersion" = 1
    AND (c)."rulesetId" = 'movement-resolution' AND (c)."rulesetVersion" = '1'
    AND (c)."simulationVersion" = 'movement-resolution-v1'
    AND (c)."pinnedRuleset" = '{"schemaVersion":1,"ruleset":{"rulesetId":"movement-resolution","version":"1"},"simulationVersion":"movement-resolution-v1","movementTieBreakPolicy":"seeded-shuffle-v1"}'::jsonb
    AND jsonb_typeof((c)."config") = 'object'
    AND (c)."config" - ARRAY['schemaVersion','gameId','turnDurationMs'] = '{}'::jsonb
    AND (c)."config"->'schemaVersion' = '1'::jsonb
    AND (c)."config"->'gameId' = to_jsonb((c)."matchId")
    AND (c)."config"->'turnDurationMs' = to_jsonb((c)."turnDurationMs")) IS TRUE;
$$;

CREATE FUNCTION guard_movement_resolution_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lifecycle "MatchStatus";
BEGIN
  IF NEW."simulationVersion" = 'movement-resolution-v1' OR NEW."rulesetId" = 'movement-resolution' THEN
    SELECT "status" INTO STRICT lifecycle FROM "Match" WHERE "id" = NEW."matchId" FOR UPDATE;
    IF NOT movement_resolution_profile_ok(NEW) OR lifecycle <> 'OPEN' THEN RAISE EXCEPTION 'Invalid creation-time draft profile'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movement_resolution_configuration BEFORE INSERT ON "MatchConfiguration" FOR EACH ROW EXECUTE FUNCTION guard_movement_resolution_configuration();

-- Structural/geographic validation complements application replay of canonical snapshots/IDs.
CREATE FUNCTION resolution_queue_ok(key text, actor text, orders jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE s jsonb; w jsonb; f jsonb; o jsonb; x double precision; y double precision; px double precision; py double precision; total double precision := 0;
  -- The exact ECMAScript trim set used by identifier, not locale-dependent regex classes.
  trim_chars CONSTANT text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
  IF jsonb_typeof(orders) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  SELECT "payload" INTO STRICT s FROM "GameSnapshotRecord" WHERE "matchId" = key AND "stateVersion" = 0;
  SELECT "payload" INTO STRICT w FROM "MatchWorld" WHERE "matchId" = key;
  SELECT value INTO STRICT f FROM jsonb_array_elements(s->'formations') WHERE value->>'ownerPlayerId' = actor;
  IF (s->>'kind' = 'movement_resolution' AND s->'schemaVersion' = '6'::jsonb AND jsonb_array_length(f->'unitIds') = 6) IS NOT TRUE THEN RETURN false; END IF;
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

CREATE FUNCTION require_initial_resolution_bundle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key text; m "Match"; c "MatchConfiguration"; w "MatchWorld"; s "GameSnapshotRecord"; t "Turn"; n integer; f jsonb; u jsonb; capital jsonb; source jsonb; member text;
BEGIN
  IF TG_TABLE_NAME = 'Match' THEN key := NEW."id"; ELSE key := NEW."matchId"; END IF;
  SELECT * INTO m FROM "Match" WHERE "id" = key;
  IF NOT FOUND THEN RETURN NULL; END IF; -- Only complete parent-match cascade cleanup.
  SELECT * INTO c FROM "MatchConfiguration" WHERE "matchId" = key;
  IF (c."simulationVersion" = 'movement-resolution-v1') IS NOT TRUE THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='GameSnapshotRecord' THEN
    IF NEW."stateVersion"=1 THEN RETURN NULL; END IF;
  END IF;
  IF m."status" <> 'RUNNING' OR m."currentStateVersion" <> 0 OR NOT movement_resolution_profile_ok(c) THEN
    RAISE EXCEPTION 'Initial artifacts must commit atomically with a supported RUNNING match';
  END IF;
  SELECT * INTO w FROM "MatchWorld" WHERE "matchId" = key;
  IF NOT FOUND THEN RAISE EXCEPTION 'Initial turn requires its world archive'; END IF;
  SELECT * INTO s FROM "GameSnapshotRecord" WHERE "matchId" = key AND "stateVersion" = 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'Initial turn requires its snapshot'; END IF;
  SELECT * INTO t FROM "Turn" WHERE "matchId" = key AND "number" = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Initial snapshot requires Turn 1'; END IF;
  IF (jsonb_typeof(s."payload") = 'object'
    AND s."payload" - ARRAY['schemaVersion','kind','snapshotId','ruleset','simulationVersion','config','completedTurnNumber','stateVersion','players','worldRef','policy','units','formations','initialArmiesSnapshotId','movementDraftSnapshotId','initialClosureSnapshotId','movementPolicy'] = '{}'::jsonb
    AND s."payload"->'schemaVersion' = '6'::jsonb AND s."payload"->>'kind' = 'movement_resolution'
    AND s."payload"->'snapshotId' = to_jsonb(s."snapshotId") AND s."snapshotId" ~ '^movement-initial:[a-f0-9]{64}$'
    AND s."payload"->>'initialClosureSnapshotId' ~ '^turn-closure:[a-f0-9]{64}$'
    AND s."payload"->'movementPolicy' = '{"version":"swept-circle-lattice-v1","worldUnitsPerMovementPoint":50,"radius":10,"contactDistance":20,"precision":0.001,"stopping":"strict-before-contact","seedSource":"world-seed-v1"}'::jsonb
    AND s."payload"->>'movementDraftSnapshotId' ~ '^movement-drafts:[a-f0-9]{64}$'
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

-- Construct the exact frozen record from durable authoritative rows, without a new digest/seed policy.
CREATE FUNCTION resolution_frozen_payload(key text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('schemaVersion',3,'kind','movement_resolution','runtimeProfile',c."pinnedRuleset",
    'startingSnapshotId',s."snapshotId",'startingStateVersion',0,'worldRef',s."payload"->'worldRef','worldSeed',w."payload"->'seed','resolutionSeed',w."payload"->'seed',
    'turn',jsonb_build_object('schemaVersion',1,'gameId',key,'turnNumber',1,'status','closed',
      'openedAtMs',t."openedAtMs",'deadlineAtMs',t."deadlineAtMs",'closedAtMs',t."closedAtMs",'closeReason',lower(t."closeReason"::text)),
    'players',(SELECT jsonb_agg(jsonb_build_object('playerId',p."playerId",'revision',p."revision",'ready',p."ready",'orders',r."orders") ORDER BY p."playerId" COLLATE "C")
      FROM "PlayerTurnState" p JOIN "PlayerSubmissionRevision" r USING ("matchId","turnNumber","playerId","revision") WHERE p."matchId"=key AND p."turnNumber"=1 AND p."active"))
  FROM "MatchConfiguration" c JOIN "GameSnapshotRecord" s ON s."matchId"=c."matchId" AND s."stateVersion"=0
    JOIN "MatchWorld" w ON w."matchId"=c."matchId" JOIN "Turn" t ON t."matchId"=c."matchId" AND t."number"=1 WHERE c."matchId"=key;
$$;
CREATE FUNCTION guard_movement_resolution_artifact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key text; lifecycle "MatchStatus"; c "MatchConfiguration"; t "Turn"; p "PlayerTurnState"; prior "PlayerSubmissionRevision"; candidate jsonb;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD."matchId" IS DISTINCT FROM NEW."matchId" AND EXISTS (SELECT 1 FROM "MatchConfiguration" WHERE "matchId"=OLD."matchId" AND "simulationVersion"='movement-resolution-v1') THEN RAISE EXCEPTION 'Closure records cannot change parent'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN key:=OLD."matchId"; ELSE key:=NEW."matchId"; END IF;
  SELECT "status" INTO lifecycle FROM "Match" WHERE "id"=key FOR UPDATE;
  IF NOT FOUND THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Closure artifact requires parent';
  END IF;
  SELECT * INTO c FROM "MatchConfiguration" WHERE "matchId"=key;
  -- Explicit table branches must precede every table-specific NEW/OLD reference.
  IF TG_TABLE_NAME='GameSnapshotRecord' THEN
    IF TG_OP='INSERT' THEN
      IF (NEW."payload"->'schemaVersion'='6'::jsonb OR NEW."payload"->'schemaVersion'='7'::jsonb OR NEW."payload"->>'kind' IN ('movement_resolution','movement_resolved') OR NEW."payload"->>'simulationVersion'='movement-resolution-v1') IS TRUE AND NOT movement_resolution_profile_ok(c) THEN RAISE EXCEPTION 'Closure snapshot requires exact runtime'; END IF;
    END IF;
  END IF;
  IF (c."simulationVersion"='movement-resolution-v1') IS NOT TRUE THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
  IF NOT movement_resolution_profile_ok(c) THEN RAISE EXCEPTION 'Invalid closure pins'; END IF;
  IF TG_TABLE_NAME='MatchParticipant' THEN
    IF lifecycle<>'OPEN' THEN RAISE EXCEPTION 'Closure roster is immutable after start'; END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
  IF TG_TABLE_NAME='GameSnapshotRecord' THEN
    IF TG_OP='INSERT' THEN
      IF NEW."stateVersion"=1 AND lifecycle='RUNNING' THEN
        SELECT * INTO STRICT t FROM "Turn" WHERE "matchId"=key AND "number"=1;
        IF t."status"<>'RESOLVING' OR NEW."completedTurnNumber"<>1 OR NEW."payload"->'schemaVersion'<>'7'::jsonb OR NEW."payload"->>'kind'<>'movement_resolved' OR NEW."snapshotId" !~ '^movement-resolved:[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid resolved movement snapshot'; END IF;
        RETURN NEW;
      END IF;
    END IF;
  END IF;
  IF TG_TABLE_NAME='ResolutionResult' THEN
    IF TG_OP<>'INSERT' OR lifecycle<>'RUNNING' THEN RAISE EXCEPTION 'Movement result is insert-once immutable'; END IF;
    SELECT * INTO STRICT t FROM "Turn" WHERE "matchId"=key AND "number"=1;
    IF t."status"<>'RESOLVING' OR NEW."turnNumber"<>1 OR NEW."nextStateVersion"<>1 OR NEW."payload"->'schemaVersion'<>'2'::jsonb OR NEW."payload"->>'kind'<>'movement_resolution'
      OR NEW."payload"->>'resolutionId' IS DISTINCT FROM NEW."resolutionId"
      OR NEW."payload"->'seed' IS DISTINCT FROM (SELECT to_jsonb("seed") FROM "FrozenTurnInputRecord" WHERE "matchId"=key AND "turnNumber"=1)
      OR NEW."payload"->'nextState' IS DISTINCT FROM (SELECT "payload" FROM "GameSnapshotRecord" WHERE "matchId"=key AND "stateVersion"=1) THEN RAISE EXCEPTION 'Movement result/snapshot/seed mismatch'; END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME IN ('OrderDependency') THEN RAISE EXCEPTION 'Closure runtime cannot resolve or execute gameplay'; END IF;
  IF TG_TABLE_NAME IN ('MatchWorld','GameSnapshotRecord') THEN
    IF TG_OP<>'INSERT' OR lifecycle<>'OPEN' THEN RAISE EXCEPTION 'Closure world and snapshot are immutable'; END IF;
    IF TG_TABLE_NAME='GameSnapshotRecord' THEN
      IF (NEW."stateVersion"=0 AND NEW."completedTurnNumber"=0 AND NEW."snapshotId" ~ '^movement-initial:[a-f0-9]{64}$') IS NOT TRUE THEN RAISE EXCEPTION 'Invalid v5 snapshot'; END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME='Turn' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Closure Turn is immutable'; END IF;
    IF TG_OP='INSERT' THEN
      IF lifecycle<>'OPEN' OR (NEW."number"=1 AND NEW."startingStateVersion"=0 AND NEW."status"='OPEN' AND NEW."lastObservedAtMs"=NEW."openedAtMs") IS NOT TRUE THEN RAISE EXCEPTION 'Only initial OPEN Turn 1 allowed'; END IF;
    ELSE
      IF lifecycle='RUNNING' AND ((OLD."status"='CLOSED' AND NEW."status"='RESOLVING') OR (OLD."status"='RESOLVING' AND NEW."status"='RESOLVED')) THEN RETURN NEW; END IF;
      IF lifecycle<>'RUNNING' OR OLD."status"<>'OPEN' OR NEW."status" NOT IN ('OPEN','CLOSED') THEN RAISE EXCEPTION 'Closure Turn cannot reopen, resolve or advance'; END IF;
      IF NEW."status"='OPEN' AND NEW."lastObservedAtMs">=NEW."deadlineAtMs" THEN RAISE EXCEPTION 'Observed deadline must close'; END IF;
      IF NEW."status"='CLOSED' THEN
        IF NEW."closeReason"='ALL_READY' AND floor(extract(epoch FROM clock_timestamp())*1000)>=NEW."deadlineAtMs" THEN RAISE EXCEPTION 'Closure acceptance window expired' USING ERRCODE='P0059'; END IF;
        IF (NEW."closeReason"='DEADLINE' AND NEW."lastObservedAtMs">=NEW."deadlineAtMs") OR
          (NEW."closeReason"='ALL_READY' AND NEW."closedAtMs"=NEW."lastObservedAtMs" AND NEW."lastObservedAtMs"<NEW."deadlineAtMs") THEN RETURN NEW; END IF;
        RAISE EXCEPTION 'Invalid closure observation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME='FrozenTurnInputRecord' THEN
    IF TG_OP<>'INSERT' OR lifecycle<>'RUNNING' THEN RAISE EXCEPTION 'Closure frozen input is insert-once immutable'; END IF;
    SELECT * INTO STRICT t FROM "Turn" WHERE "matchId"=key AND "number"=1;
    IF NEW."turnNumber"<>1 OR t."status"<>'CLOSED' OR NEW."seed" IS DISTINCT FROM (SELECT "seed" FROM "MatchWorld" WHERE "matchId"=key) OR NEW."payload" IS DISTINCT FROM resolution_frozen_payload(key) THEN RAISE EXCEPTION 'Frozen input must match authoritative closed turn'; END IF;
    RETURN NEW;
  END IF;
  IF lifecycle='OPEN' THEN
    IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Closure initialization permits inserts only'; END IF;
    IF TG_TABLE_NAME='PlayerTurnState' THEN
      IF (NEW."turnNumber"=1 AND NEW."active" AND NEW."revision"=0 AND NOT NEW."ready") IS TRUE THEN RETURN NEW; END IF;
    END IF;
    IF TG_TABLE_NAME='PlayerSubmissionRevision' THEN
      IF (NEW."turnNumber"=1 AND NEW."revision"=0 AND NEW."kind"='INITIAL' AND NOT NEW."ready" AND NEW."orders"='[]'::jsonb AND NEW."command" IS NULL) IS TRUE THEN RETURN NEW; END IF;
    END IF;
    RAISE EXCEPTION 'Only empty unready revision-zero initialization allowed';
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Closure history/draft deletion prohibited'; END IF;
  SELECT * INTO STRICT t FROM "Turn" WHERE "matchId"=key AND "number"=1;
  IF NEW."turnNumber"<>1 OR t."status"<>'OPEN' THEN RAISE EXCEPTION 'Closure draft requires OPEN Turn 1'; END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW."turnNumber",NEW."playerId") IS DISTINCT FROM (OLD."turnNumber",OLD."playerId") THEN RAISE EXCEPTION 'Closure draft identity immutable'; END IF;
  END IF;
  SELECT * INTO STRICT p FROM "PlayerTurnState" WHERE "matchId"=key AND "turnNumber"=1 AND "playerId"=NEW."playerId";
  IF NOT p."active" THEN RAISE EXCEPTION 'Only active closure participants'; END IF;
  SELECT * INTO STRICT prior FROM "PlayerSubmissionRevision" WHERE "matchId"=key AND "turnNumber"=1 AND "playerId"=p."playerId" AND "revision"=p."revision";
  IF TG_TABLE_NAME='PlayerSubmissionRevision' THEN
    IF floor(extract(epoch FROM clock_timestamp())*1000)<t."openedAtMs" THEN RAISE EXCEPTION 'Closure clock precedes opening'; END IF;
    IF floor(extract(epoch FROM clock_timestamp())*1000)>=t."deadlineAtMs" THEN RAISE EXCEPTION 'Closure acceptance window expired' USING ERRCODE='P0059'; END IF;
    IF TG_OP<>'INSERT' OR (NEW."revision"=p."revision"+1 AND jsonb_typeof(NEW."command")='object'
      AND NEW."command"->'schemaVersion'='1'::jsonb AND NEW."command"->>'gameId'=key AND NEW."command"->'turnNumber'='1'::jsonb
      AND NEW."command"->'expectedRevision'=to_jsonb(p."revision") AND resolution_queue_ok(key,p."playerId",NEW."orders")) IS NOT TRUE THEN RAISE EXCEPTION 'Invalid closure revision'; END IF;
    IF NEW."kind"='SET_READY' THEN
      IF (NEW."command"->>'kind'='set_ready' AND NEW."command" - ARRAY['schemaVersion','gameId','turnNumber','expectedRevision','kind','ready']='{}'::jsonb
        AND NEW."command"->'ready'=to_jsonb(NEW."ready") AND NEW."ready"<>p."ready" AND NEW."orders"=prior."orders") IS NOT TRUE THEN RAISE EXCEPTION 'Readiness must explicitly change and preserve orders'; END IF;
    ELSE
      IF p."ready" OR NEW."ready" THEN RAISE EXCEPTION 'Ready locks draft editing'; END IF;
      IF NEW."kind"='REPLACE_ORDERS' THEN
        IF (NEW."command"->>'kind'='replace_orders' AND NEW."command" - ARRAY['schemaVersion','gameId','turnNumber','expectedRevision','kind','orders']='{}'::jsonb AND NEW."command"->'orders'=NEW."orders") IS NOT TRUE THEN RAISE EXCEPTION 'Invalid closure replacement'; END IF;
      ELSIF NEW."kind"='CANCEL_ORDER' THEN
        IF (NEW."command"->>'kind'='cancel_order' AND NEW."command" - ARRAY['schemaVersion','gameId','turnNumber','expectedRevision','kind','orderId']='{}'::jsonb AND jsonb_typeof(NEW."command"->'orderId')='string' AND EXISTS (SELECT 1 FROM jsonb_array_elements(prior."orders") o WHERE o->>'orderId'=NEW."command"->>'orderId')) IS NOT TRUE THEN RAISE EXCEPTION 'Invalid closure cancellation'; END IF;
        SELECT coalesce(jsonb_agg(value ORDER BY ord),'[]'::jsonb) INTO candidate FROM jsonb_array_elements(prior."orders") WITH ORDINALITY e(value,ord) WHERE value->>'orderId'<>NEW."command"->>'orderId';
        IF candidate IS DISTINCT FROM NEW."orders" THEN RAISE EXCEPTION 'Cancellation must preserve queue'; END IF;
      ELSE RAISE EXCEPTION 'Unsupported closure history'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME='PlayerTurnState' THEN
    IF TG_OP<>'UPDATE' OR NOT NEW."active" OR NEW."revision"<>OLD."revision"+1 OR NOT EXISTS (SELECT 1 FROM "PlayerSubmissionRevision" r WHERE r."matchId"=key AND r."turnNumber"=1 AND r."playerId"=NEW."playerId" AND r."revision"=NEW."revision" AND r."ready"=NEW."ready") THEN RAISE EXCEPTION 'Closure CAS requires next history'; END IF;
  ELSIF TG_TABLE_NAME='PlayerOrder' THEN
    IF p."ready" OR prior."kind" NOT IN ('REPLACE_ORDERS','CANCEL_ORDER') THEN RAISE EXCEPTION 'Only accepted unready edit may alter orders'; END IF;
    IF (NEW."kind"='MOVE' AND NEW."lastRevision"=p."revision" AND NEW."orderId"=NEW."payload"->>'orderId'
      AND resolution_queue_ok(key,p."playerId",jsonb_build_array(NEW."payload"))
      AND ((NEW."active" AND NEW."draftPosition">0 AND NEW."moveNumber"=NEW."draftPosition") OR (NOT NEW."active" AND NEW."draftPosition" IS NULL AND NEW."moveNumber" IS NULL))) IS NOT TRUE THEN RAISE EXCEPTION 'Invalid closure order row'; END IF;
    IF TG_OP='INSERT' AND NOT NEW."active" THEN RAISE EXCEPTION 'No invented tombstones'; END IF;
    IF TG_OP='UPDATE' THEN
      IF NEW."orderId" IS DISTINCT FROM OLD."orderId" THEN RAISE EXCEPTION 'Stable order identity immutable'; END IF;
      IF NOT NEW."active" AND (NOT OLD."active" OR NEW."payload" IS DISTINCT FROM OLD."payload" OR OLD."lastRevision">=p."revision") THEN RAISE EXCEPTION 'Invalid closure retirement'; END IF;
    END IF;
  ELSE RAISE EXCEPTION 'Unsupported closure artifact'; END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION require_resolution_bundle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key text; c "MatchConfiguration"; t "Turn"; p "PlayerTurnState"; r "PlayerSubmissionRevision"; seq bigint; last_orders jsonb; last_ready boolean; edit_revision bigint; actual jsonb;
BEGIN
  IF TG_TABLE_NAME='Match' THEN key:=NEW."id"; ELSE key:=NEW."matchId"; END IF;
  IF NOT EXISTS (SELECT 1 FROM "Match" WHERE "id"=key) THEN RETURN NULL; END IF;
  SELECT * INTO c FROM "MatchConfiguration" WHERE "matchId"=key;
  IF (c."simulationVersion"='movement-resolution-v1') IS NOT TRUE THEN RETURN NULL; END IF;
  SELECT * INTO STRICT t FROM "Turn" WHERE "matchId"=key AND "number"=1;
  FOR p IN SELECT * FROM "PlayerTurnState" WHERE "matchId"=key ORDER BY "playerId" LOOP
    IF p."turnNumber"<>1 OR NOT p."active" THEN RAISE EXCEPTION 'Invalid closure player'; END IF;
    seq:=0; last_orders:='[]'::jsonb; last_ready:=false; edit_revision:=0;
    FOR r IN SELECT * FROM "PlayerSubmissionRevision" WHERE "matchId"=key AND "turnNumber"=1 AND "playerId"=p."playerId" ORDER BY "revision" LOOP
      IF r."revision"<>seq OR NOT resolution_queue_ok(key,p."playerId",r."orders") THEN RAISE EXCEPTION 'Closure history gap or invalid queue'; END IF;
      IF seq=0 THEN
        IF r."kind"<>'INITIAL' OR r."ready" OR r."command" IS NOT NULL OR r."orders"<>'[]'::jsonb THEN RAISE EXCEPTION 'Invalid closure initial history'; END IF;
      ELSE
        IF (r."command"->'expectedRevision'=to_jsonb(seq-1) AND r."command"->>'gameId'=key AND r."command"->'turnNumber'='1'::jsonb) IS NOT TRUE THEN RAISE EXCEPTION 'Closure history scope mismatch'; END IF;
        IF r."kind"='SET_READY' THEN
          IF r."ready"=last_ready OR r."orders"<>last_orders THEN RAISE EXCEPTION 'Invalid readiness history'; END IF;
        ELSE
          IF last_ready OR r."ready" THEN RAISE EXCEPTION 'Ready history locks editing'; END IF;
          edit_revision:=r."revision";
        END IF;
      END IF;
      last_orders:=r."orders"; last_ready:=r."ready"; seq:=seq+1;
    END LOOP;
    IF seq<>p."revision"+1 OR p."ready"<>last_ready THEN RAISE EXCEPTION 'Closure state requires complete matching history'; END IF;
    SELECT coalesce(jsonb_agg("payload" ORDER BY "draftPosition"),'[]'::jsonb) INTO actual FROM "PlayerOrder" WHERE "matchId"=key AND "turnNumber"=1 AND "playerId"=p."playerId" AND "active";
    IF actual IS DISTINCT FROM last_orders OR EXISTS (SELECT 1 FROM (SELECT "draftPosition","moveNumber","lastRevision",row_number() OVER (ORDER BY "draftPosition") AS n FROM "PlayerOrder" WHERE "matchId"=key AND "turnNumber"=1 AND "playerId"=p."playerId" AND "active") q WHERE q."draftPosition"<>q.n OR q."moveNumber"<>q.n OR q."lastRevision"<>edit_revision) THEN RAISE EXCEPTION 'Closure order rows disagree with latest accepted edit'; END IF;
  END LOOP;
  IF t."status"='OPEN' THEN
    IF EXISTS (SELECT 1 FROM "FrozenTurnInputRecord" WHERE "matchId"=key) OR NOT EXISTS (SELECT 1 FROM "PlayerTurnState" WHERE "matchId"=key AND NOT "ready") THEN RAISE EXCEPTION 'OPEN closure turn cannot have frozen input or unanimous Ready'; END IF;
  ELSIF t."status" IN ('CLOSED','RESOLVING','RESOLVED') THEN
    IF NOT EXISTS (SELECT 1 FROM "FrozenTurnInputRecord" WHERE "matchId"=key AND "turnNumber"=1 AND "seed"=(SELECT "seed" FROM "MatchWorld" WHERE "matchId"=key) AND "payload"=resolution_frozen_payload(key)) THEN RAISE EXCEPTION 'CLOSED requires exactly one matching immutable frozen input'; END IF;
  ELSE RAISE EXCEPTION 'Invalid movement lifecycle'; END IF;
  IF t."status"='RESOLVING' THEN RAISE EXCEPTION 'RESOLVING cannot commit without atomic result'; END IF;
  IF t."status"='RESOLVED' THEN
    IF NOT EXISTS (SELECT 1 FROM "ResolutionResult" WHERE "matchId"=key AND "turnNumber"=1 AND "nextStateVersion"=1)
      OR (SELECT "currentStateVersion" FROM "Match" WHERE "id"=key)<>1 THEN RAISE EXCEPTION 'Resolved movement bundle incomplete'; END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE FUNCTION guard_resolution_match_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM "MatchConfiguration" WHERE "matchId"=OLD."id" AND "simulationVersion"='movement-resolution-v1') THEN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR (OLD."status"='RUNNING' AND NEW."status"<>OLD."status") THEN RAISE EXCEPTION 'Movement match identity/lifecycle immutable'; END IF;
  IF NEW."currentStateVersion" IS DISTINCT FROM OLD."currentStateVersion" THEN
   IF OLD."currentStateVersion"<>0 OR NEW."currentStateVersion"<>1 OR NOT EXISTS (SELECT 1 FROM "Turn" WHERE "matchId"=OLD."id" AND "number"=1 AND "status"='RESOLVED') OR NOT EXISTS (SELECT 1 FROM "ResolutionResult" WHERE "matchId"=OLD."id" AND "turnNumber"=1) THEN RAISE EXCEPTION 'Movement state advances once with its result'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER resolution_match_version BEFORE UPDATE ON "Match" FOR EACH ROW EXECUTE FUNCTION guard_resolution_match_version();
CREATE TRIGGER resolution_world BEFORE INSERT OR UPDATE OR DELETE ON "MatchWorld" FOR EACH ROW EXECUTE FUNCTION guard_movement_resolution_artifact();
CREATE TRIGGER resolution_snapshot BEFORE INSERT OR UPDATE OR DELETE ON "GameSnapshotRecord" FOR EACH ROW EXECUTE FUNCTION guard_movement_resolution_artifact();
CREATE TRIGGER resolution_turn BEFORE INSERT OR UPDATE OR DELETE ON "Turn" FOR EACH ROW EXECUTE FUNCTION guard_movement_resolution_artifact();
CREATE TRIGGER resolution_player BEFORE INSERT OR UPDATE OR DELETE ON "PlayerTurnState" FOR EACH ROW EXECUTE FUNCTION guard_movement_resolution_artifact();
CREATE TRIGGER resolution_history BEFORE INSERT OR UPDATE OR DELETE ON "PlayerSubmissionRevision" FOR EACH ROW EXECUTE FUNCTION guard_movement_resolution_artifact();
CREATE TRIGGER resolution_order BEFORE INSERT OR UPDATE OR DELETE ON "PlayerOrder" FOR EACH ROW EXECUTE FUNCTION guard_movement_resolution_artifact();
CREATE TRIGGER resolution_dependency BEFORE INSERT OR UPDATE OR DELETE ON "OrderDependency" FOR EACH ROW EXECUTE FUNCTION guard_movement_resolution_artifact();
CREATE TRIGGER resolution_frozen BEFORE INSERT OR UPDATE OR DELETE ON "FrozenTurnInputRecord" FOR EACH ROW EXECUTE FUNCTION guard_movement_resolution_artifact();
CREATE TRIGGER resolution_result BEFORE INSERT OR UPDATE OR DELETE ON "ResolutionResult" FOR EACH ROW EXECUTE FUNCTION guard_movement_resolution_artifact();
CREATE TRIGGER resolution_roster BEFORE INSERT OR UPDATE OR DELETE ON "MatchParticipant" FOR EACH ROW EXECUTE FUNCTION guard_movement_resolution_artifact();
CREATE CONSTRAINT TRIGGER resolution_initial_world AFTER INSERT ON "MatchWorld" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_initial_resolution_bundle();
CREATE CONSTRAINT TRIGGER resolution_initial_snapshot AFTER INSERT ON "GameSnapshotRecord" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_initial_resolution_bundle();
CREATE CONSTRAINT TRIGGER resolution_initial_turn AFTER INSERT ON "Turn" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_initial_resolution_bundle();
CREATE CONSTRAINT TRIGGER resolution_started AFTER UPDATE ON "Match" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD."status"='OPEN' AND NEW."status"='RUNNING') EXECUTE FUNCTION require_initial_resolution_bundle();
CREATE CONSTRAINT TRIGGER resolution_complete_turn AFTER INSERT OR UPDATE ON "Turn" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_resolution_bundle();
CREATE CONSTRAINT TRIGGER resolution_complete_player AFTER INSERT OR UPDATE ON "PlayerTurnState" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_resolution_bundle();
CREATE CONSTRAINT TRIGGER resolution_complete_history AFTER INSERT OR UPDATE ON "PlayerSubmissionRevision" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_resolution_bundle();
CREATE CONSTRAINT TRIGGER resolution_complete_order AFTER INSERT OR UPDATE ON "PlayerOrder" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_resolution_bundle();
CREATE CONSTRAINT TRIGGER resolution_complete_frozen AFTER INSERT OR UPDATE ON "FrozenTurnInputRecord" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_resolution_bundle();
CREATE FUNCTION delete_resolution_children() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "MatchConfiguration" WHERE "matchId"=OLD."id" AND "simulationVersion"='movement-resolution-v1') THEN
    DELETE FROM "ResolutionResult" WHERE "matchId"=OLD."id";
    DELETE FROM "FrozenTurnInputRecord" WHERE "matchId"=OLD."id";
    DELETE FROM "PlayerSubmissionRevision" WHERE "matchId"=OLD."id";
    DELETE FROM "PlayerTurnState" WHERE "matchId"=OLD."id";
    DELETE FROM "Turn" WHERE "matchId"=OLD."id";
    DELETE FROM "GameSnapshotRecord" WHERE "matchId"=OLD."id";
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER "A_resolution_cascade" AFTER DELETE ON "Match" FOR EACH ROW EXECUTE FUNCTION delete_resolution_children();
CREATE OR REPLACE FUNCTION require_initial_turn_bundle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key text; m "Match"; c "MatchConfiguration"; w "MatchWorld"; s "GameSnapshotRecord"; t "Turn"; n integer;
BEGIN
  IF TG_TABLE_NAME = 'Match' THEN key := NEW."id"; ELSE key := NEW."matchId"; END IF;
  SELECT * INTO m FROM "Match" WHERE "id" = key;
  IF NOT FOUND THEN RETURN NULL; END IF; -- Only complete parent-match cascade cleanup.
  SELECT * INTO c FROM "MatchConfiguration" WHERE "matchId" = key;
  IF TG_TABLE_NAME = 'Match' AND (c."matchId" IS NULL OR NOT (
    (c."rulesetId" IS NULL AND c."rulesetVersion" IS NULL AND c."simulationVersion" IS NULL AND c."pinnedRuleset" IS NULL)
    OR initial_turn_profile_ok(c) OR initial_armies_profile_ok(c) OR movement_drafts_profile_ok(c) OR turn_closure_profile_ok(c) OR movement_resolution_profile_ok(c))) THEN RAISE EXCEPTION 'Unsupported lobby start runtime'; END IF;
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

CREATE FUNCTION require_movement_result_bundle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key text; s jsonb; n jsonb; r jsonb; f jsonb; member jsonb; original jsonb;
BEGIN
 key:=NEW."matchId";
 IF NOT EXISTS(SELECT 1 FROM "Match" WHERE "id"=key) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM "MatchConfiguration" WHERE "matchId"=key AND "simulationVersion"='movement-resolution-v1') THEN RETURN NULL; END IF;
 SELECT "payload" INTO s FROM "GameSnapshotRecord" WHERE "matchId"=key AND "stateVersion"=0;
 SELECT "payload" INTO n FROM "GameSnapshotRecord" WHERE "matchId"=key AND "stateVersion"=1;
 SELECT "payload" INTO r FROM "ResolutionResult" WHERE "matchId"=key AND "turnNumber"=1;
 IF (SELECT "status" FROM "Turn" WHERE "matchId"=key AND "number"=1)='RESOLVED' THEN
  IF n IS NULL OR r IS NULL OR n->'initialSnapshotId' IS DISTINCT FROM s->'snapshotId' OR r->'startingSnapshotId' IS DISTINCT FROM s->'snapshotId'
   OR n->'units' IS DISTINCT FROM s->'units' OR n->'players' IS DISTINCT FROM s->'players' OR n->'worldRef' IS DISTINCT FROM s->'worldRef'
   OR n->'initialClosureSnapshotId' IS DISTINCT FROM s->'initialClosureSnapshotId' OR n->'initialArmiesSnapshotId' IS DISTINCT FROM s->'initialArmiesSnapshotId' OR n->'movementDraftSnapshotId' IS DISTINCT FROM s->'movementDraftSnapshotId' OR n->'policy' IS DISTINCT FROM s->'policy'
   OR n->'resolutionId' IS DISTINCT FROM r->'resolutionId' OR r->'runtimeProfile' IS DISTINCT FROM (SELECT "pinnedRuleset" FROM "MatchConfiguration" WHERE "matchId"=key) OR r->'policy' IS DISTINCT FROM s->'movementPolicy'
   OR n->'config' IS DISTINCT FROM s->'config' OR n->'movementPolicy' IS DISTINCT FROM s->'movementPolicy'
   OR n->'ruleset' IS DISTINCT FROM s->'ruleset' OR n->'simulationVersion' IS DISTINCT FROM s->'simulationVersion'
   OR n->'stateVersion'<>'1'::jsonb OR n->'completedTurnNumber'<>'1'::jsonb
   OR r->'nextState' IS DISTINCT FROM n OR jsonb_array_length(n->'formations')<>jsonb_array_length(s->'formations') THEN RAISE EXCEPTION 'Resolved movement identity/invariants mismatch'; END IF;
  IF jsonb_array_length(n->'formations')<>(SELECT count(DISTINCT value->>'formationId') FROM jsonb_array_elements(n->'formations')) THEN RAISE EXCEPTION 'Duplicate resolved formation'; END IF;
  FOR f IN SELECT value FROM jsonb_array_elements(n->'formations') LOOP
   SELECT value INTO STRICT original FROM jsonb_array_elements(s->'formations') WHERE value->>'formationId'=f->>'formationId';
   IF f-'position' IS DISTINCT FROM original-'position' OR jsonb_typeof(f->'position') IS DISTINCT FROM 'object'
     OR (f->'position')-ARRAY['xMilli','yMilli']<>'{}'::jsonb THEN RAISE EXCEPTION 'Resolved formation membership immutable'; END IF;
   IF (jsonb_typeof(f#>'{position,xMilli}')='number' AND jsonb_typeof(f#>'{position,yMilli}')='number') IS NOT TRUE THEN RAISE EXCEPTION 'Missing milliworld coordinate'; END IF;
   IF (f#>>'{position,xMilli}')::numeric <> trunc((f#>>'{position,xMilli}')::numeric) OR (f#>>'{position,yMilli}')::numeric <> trunc((f#>>'{position,yMilli}')::numeric)
    OR (f#>>'{position,xMilli}')::numeric NOT BETWEEN 0 AND (SELECT ("payload"#>>'{bounds,width}')::numeric*1000 FROM "MatchWorld" WHERE "matchId"=key)
    OR (f#>>'{position,yMilli}')::numeric NOT BETWEEN 0 AND (SELECT ("payload"#>>'{bounds,height}')::numeric*1000 FROM "MatchWorld" WHERE "matchId"=key) THEN RAISE EXCEPTION 'Invalid milliworld position'; END IF;
  END LOOP;
 ELSIF n IS NOT NULL OR r IS NOT NULL THEN RAISE EXCEPTION 'Movement result must commit RESOLVED'; END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER movement_final_snapshot AFTER INSERT ON "GameSnapshotRecord" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_movement_result_bundle();
CREATE CONSTRAINT TRIGGER movement_final_result AFTER INSERT ON "ResolutionResult" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_movement_result_bundle();
CREATE CONSTRAINT TRIGGER movement_final_turn AFTER UPDATE ON "Turn" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_movement_result_bundle();
CREATE FUNCTION guard_movement_commit_window() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "MatchConfiguration"; t "Turn";
BEGIN
  -- All attached row shapes have matchId; no table-specific NEW fields are referenced.
  IF NOT EXISTS (SELECT 1 FROM "Match" WHERE "id"=NEW."matchId") THEN RETURN NULL; END IF;
  SELECT * INTO c FROM "MatchConfiguration" WHERE "matchId"=NEW."matchId";
  IF (c."simulationVersion"='movement-resolution-v1') IS NOT TRUE THEN RETURN NULL; END IF;
  SELECT * INTO STRICT t FROM "Turn" WHERE "matchId"=NEW."matchId" AND "number"=1;
  -- Expired initialization with revision-zero drafts remains valid. Deadline closure
  -- is also valid; it must freeze only drafts committed by earlier transactions.
  IF t."status"='RESOLVED' THEN RETURN NULL; END IF;
  IF t."status"='CLOSED' AND t."closeReason"='DEADLINE' THEN RETURN NULL; END IF;
  IF (t."closeReason"='ALL_READY' OR EXISTS (SELECT 1 FROM "PlayerTurnState" WHERE "matchId"=NEW."matchId" AND "revision">0))
    AND floor(extract(epoch FROM clock_timestamp())*1000)>=t."deadlineAtMs" THEN
    RAISE EXCEPTION 'Closure acceptance window expired at commit' USING ERRCODE='P0059';
  END IF;
  RETURN NULL;
END;
$$;
-- Sort after the cohort completeness/audit triggers for each deferred row event.
CREATE CONSTRAINT TRIGGER zz_movement_commit_history AFTER INSERT ON "PlayerSubmissionRevision" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_movement_commit_window();
CREATE CONSTRAINT TRIGGER zz_movement_commit_player AFTER INSERT OR UPDATE ON "PlayerTurnState" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_movement_commit_window();
CREATE CONSTRAINT TRIGGER zz_movement_commit_order AFTER INSERT OR UPDATE ON "PlayerOrder" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_movement_commit_window();
CREATE CONSTRAINT TRIGGER zz_movement_commit_turn AFTER INSERT OR UPDATE ON "Turn" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_movement_commit_window();
CREATE CONSTRAINT TRIGGER zz_movement_commit_frozen AFTER INSERT ON "FrozenTurnInputRecord" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_movement_commit_window();
COMMIT;
