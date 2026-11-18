-- Europe-only additive guards; no historical function replaced except explicit start admission.
-- Additive repeating cohort only. Offline authored; execute solely in approved fresh hosted CI.
BEGIN;
CREATE FUNCTION europe_loop_profile_ok(c "MatchConfiguration") RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT ((c)."schemaVersion"=1 AND (c)."playerCapacity"=2 AND (c)."rulesetId"='europe-playtest' AND (c)."rulesetVersion"='1' AND (c)."simulationVersion"='europe-playtest-v1'
  AND (c)."pinnedRuleset"='{"schemaVersion":2,"ruleset":{"rulesetId":"europe-playtest","version":"1"},"simulationVersion":"europe-playtest-v1","movementTieBreakPolicy":"chronological-speed-v1","europe":{"mapId":"europe-playtest-map-v1","projectionId":"europe-mercator-fixed-v2","maskId":"europe-ne10m-surface-v2","maskSha256":"052b866179d2566fd37b2f22301d48c5e5fcec3f97e6e4bd806dcdc78374bfe6","distanceId":"europe-100-mask-per-game-v1","scenarioId":"iberian-two-camps-v1"}}'::jsonb
  AND (c)."config"=jsonb_build_object('schemaVersion',1,'gameId',(c)."matchId",'turnDurationMs',(c)."turnDurationMs")) IS TRUE;
$$;
CREATE FUNCTION europe_loop_queue_ok(key text, n bigint, actor text, orders jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE s jsonb; w jsonb; o jsonb; f jsonb; previous jsonb; x double precision; y double precision; total double precision; id text;
BEGIN
 IF jsonb_typeof(orders) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 SELECT "payload" INTO STRICT s FROM "GameSnapshotRecord" WHERE "matchId"=key AND "stateVersion"=n-1;
 SELECT "payload" INTO STRICT w FROM "MatchWorld" WHERE "matchId"=key;
 IF jsonb_array_length(orders)<>(SELECT count(DISTINCT value->>'orderId') FROM jsonb_array_elements(orders)) THEN RETURN false; END IF;
 FOR o IN SELECT value FROM jsonb_array_elements(orders) LOOP
  IF (jsonb_typeof(o)='object' AND o-ARRAY['type','stackId','orderId','destination']='{}'::jsonb AND o->>'type'='move'
   AND jsonb_typeof(o->'orderId')='string' AND length(o->>'orderId') BETWEEN 1 AND 128 AND btrim(o->>'orderId')=o->>'orderId'
   AND jsonb_typeof(o->'destination')='object' AND (o->'destination')-ARRAY['x','y']='{}'::jsonb
   AND jsonb_typeof(o#>'{destination,x}')='number' AND jsonb_typeof(o#>'{destination,y}')='number') IS NOT TRUE THEN RETURN false; END IF;
  IF (o#>>'{destination,x}')::numeric<>trunc((o#>>'{destination,x}')::numeric) OR (o#>>'{destination,y}')::numeric<>trunc((o#>>'{destination,y}')::numeric) THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s->'formations') form WHERE form->'formationId'=o->'stackId' AND form->>'ownerPlayerId'=actor) THEN RETURN false; END IF;
  x:=(o#>>'{destination,x}')::double precision;y:=(o#>>'{destination,y}')::double precision;
  IF x<0 OR y<0 OR x>(w#>>'{bounds,width}')::double precision OR y>(w#>>'{bounds,height}')::double precision THEN RETURN false; END IF;
 END LOOP;
 FOR f IN SELECT value FROM jsonb_array_elements(s->'formations') WHERE value->>'ownerPlayerId'=actor LOOP
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(orders) move WHERE move->'stackId'=f->'formationId') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s->'units') unit WHERE unit->>'kind'='LEADER' AND (f->'unitIds') @> jsonb_build_array(unit->'unitId')) THEN RETURN false; END IF;
  previous:=jsonb_build_object('x',(f#>>'{position,xMilli}')::numeric/1000,'y',(f#>>'{position,yMilli}')::numeric/1000);total:=0;
  FOR o IN SELECT value FROM jsonb_array_elements(orders) WHERE value->'stackId'=f->'formationId' LOOP
   total:=total+sqrt(power((o#>>'{destination,x}')::double precision-(previous->>'x')::double precision,2)+power((o#>>'{destination,y}')::double precision-(previous->>'y')::double precision,2));previous:=o->'destination';
  END LOOP;
  IF total>250 THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END;
$$;
CREATE FUNCTION europe_loop_frozen_payload(key text,n bigint,identity text) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('schemaVersion',6,'kind','europe_loop_frozen','runtimeProfile',c."pinnedRuleset",'startingSnapshotId',s."snapshotId",'startingStateVersion',n-1,
 'worldRef',s."payload"->'worldRef','worldSeed',w."seed",'resolutionSeed',mod(w."seed"+n-1,4294967296),'seedIdentity',identity,'combatPolicy',s."payload"->'combatPolicy',
 'turn',jsonb_build_object('schemaVersion',1,'gameId',key,'turnNumber',n,'status','closed','openedAtMs',t."openedAtMs",'deadlineAtMs',t."deadlineAtMs",'closedAtMs',t."closedAtMs",'closeReason',lower(t."closeReason"::text)),
 'players',(SELECT jsonb_agg(jsonb_build_object('playerId',p."playerId",'revision',p."revision",'ready',p."ready",'orders',r."orders") ORDER BY p."playerId" COLLATE "C") FROM "PlayerTurnState" p JOIN "PlayerSubmissionRevision" r USING("matchId","turnNumber","playerId","revision") WHERE p."matchId"=key AND p."turnNumber"=n))
 FROM "MatchConfiguration" c JOIN "MatchWorld" w ON w."matchId"=c."matchId" JOIN "Turn" t ON t."matchId"=c."matchId" AND t."number"=n JOIN "GameSnapshotRecord" s ON s."matchId"=c."matchId" AND s."stateVersion"=n-1 WHERE c."matchId"=key;
$$;
CREATE FUNCTION europe_loop_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key text; c "MatchConfiguration"; m "Match"; t "Turn"; p "PlayerTurnState"; prior "PlayerSubmissionRevision"; candidate jsonb; n bigint; clock_ms bigint;
BEGIN
 IF TG_OP='DELETE' THEN key:=OLD."matchId"; ELSE key:=NEW."matchId"; END IF;
 SELECT * INTO m FROM "Match" WHERE "id"=key FOR UPDATE;
 IF NOT FOUND THEN IF TG_OP='DELETE' THEN RETURN OLD; END IF; RAISE EXCEPTION 'Loop parent required'; END IF;
 SELECT * INTO c FROM "MatchConfiguration" WHERE "matchId"=key;
 IF TG_TABLE_NAME='MatchConfiguration' THEN
  IF NEW."simulationVersion"='europe-playtest-v1' THEN IF TG_OP<>'INSERT' OR m."status"<>'OPEN' OR NOT europe_loop_profile_ok(NEW) THEN RAISE EXCEPTION 'Invalid loop creation pin'; END IF; END IF; RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='GameSnapshotRecord' AND TG_OP='INSERT' THEN
  IF (NEW."payload"->>'kind'='europe_loop_state' OR NEW."payload"->'schemaVersion'='11'::jsonb) AND NOT europe_loop_profile_ok(c) THEN RAISE EXCEPTION 'Loop snapshot requires creation pin'; END IF;
 END IF;
 IF (c."simulationVersion"='europe-playtest-v1') IS NOT TRUE THEN IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
 IF NOT europe_loop_profile_ok(c) THEN RAISE EXCEPTION 'Invalid loop pin'; END IF;
 IF TG_OP='UPDATE' THEN IF OLD."matchId" IS DISTINCT FROM NEW."matchId" THEN RAISE EXCEPTION 'Loop parent immutable'; END IF; END IF;
 IF TG_TABLE_NAME='MatchParticipant' THEN
  IF m."status"<>'OPEN' THEN RAISE EXCEPTION 'Loop roster sealed'; END IF; IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Loop artifacts immutable'; END IF;
 IF TG_TABLE_NAME='MatchWorld' THEN IF TG_OP<>'INSERT' OR m."status"<>'OPEN' THEN RAISE EXCEPTION 'Loop archive immutable'; END IF; IF NEW."seed"<>1 OR NEW."payload"#>'{bounds}'<>'{"width":1000,"height":500}'::jsonb OR NEW."payload"#>'{settings,regionSide}'<>'5'::jsonb OR jsonb_array_length(NEW."payload"->'players')<>2 THEN RAISE EXCEPTION 'Invalid Europe scenario'; END IF; RETURN NEW; END IF;
 IF TG_TABLE_NAME='OrderDependency' THEN RAISE EXCEPTION 'Loop prerequisites unsupported'; END IF;
 IF TG_TABLE_NAME='GameSnapshotRecord' THEN
  IF TG_OP<>'INSERT' OR NEW."stateVersion"<0 OR NEW."stateVersion">4294967294 OR NEW."completedTurnNumber"<>NEW."stateVersion"
   OR (NEW."payload"->'schemaVersion'='11'::jsonb AND NEW."payload"->>'kind'='europe_loop_state' AND NEW."payload"->'stateVersion'=to_jsonb(NEW."stateVersion") AND NEW."payload"->'completedTurnNumber'=to_jsonb(NEW."stateVersion") AND NEW."payload"->'snapshotId'=to_jsonb(NEW."snapshotId") AND NEW."snapshotId"~'^loop-state:[a-f0-9]{64}$') IS NOT TRUE THEN RAISE EXCEPTION 'Invalid loop snapshot'; END IF;
  IF NEW."stateVersion"=0 THEN IF m."status"<>'OPEN' THEN RAISE EXCEPTION 'No loop backfill'; END IF;
  ELSE SELECT * INTO STRICT t FROM "Turn" WHERE "matchId"=key AND "number"=NEW."stateVersion";IF t."status"<>'RESOLVING' OR m."currentStateVersion"<>NEW."stateVersion"-1 THEN RAISE EXCEPTION 'Loop snapshot requires current resolution'; END IF; END IF; RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='ResolutionResult' THEN
  SELECT * INTO STRICT t FROM "Turn" WHERE "matchId"=key AND "number"=NEW."turnNumber";
  IF TG_OP<>'INSERT' OR t."status"<>'RESOLVING' OR NEW."nextStateVersion"<>NEW."turnNumber" OR NEW."turnNumber"<>m."currentStateVersion"+1
   OR (NEW."payload"->'schemaVersion'='2'::jsonb AND NEW."payload"->>'kind'='europe_loop_commit' AND jsonb_typeof(NEW."payload"->'nextOpenedAtMs')='number' AND NEW."payload"#>'{result,schemaVersion}'='5'::jsonb AND NEW."payload"#>>'{result,kind}'='europe_loop_result'
    AND NEW."payload"#>'{result,turnNumber}'=to_jsonb(NEW."turnNumber") AND NEW."payload"#>'{result,resolutionId}'=to_jsonb(NEW."resolutionId")
    AND NEW."payload"#>'{result,nextState}'=(SELECT "payload" FROM "GameSnapshotRecord" WHERE "matchId"=key AND "stateVersion"=NEW."turnNumber")
    AND NEW."payload"#>'{result,seed}'=(SELECT to_jsonb("seed") FROM "FrozenTurnInputRecord" WHERE "matchId"=key AND "turnNumber"=NEW."turnNumber")) IS NOT TRUE THEN RAISE EXCEPTION 'Invalid loop commit'; END IF;
  IF (NEW."payload"->>'nextOpenedAtMs')::numeric<t."lastObservedAtMs" OR (NEW."payload"->>'nextOpenedAtMs')::numeric>floor(extract(epoch FROM clock_timestamp())*1000) OR (NEW."payload"->>'nextOpenedAtMs')::numeric<>trunc((NEW."payload"->>'nextOpenedAtMs')::numeric) THEN RAISE EXCEPTION 'Unsafe next opening clock'; END IF;RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='Turn' THEN
  IF TG_OP='INSERT' THEN
   IF NEW."number"<>m."currentStateVersion"+1 AND NOT(NEW."number"=m."currentStateVersion"+2 AND EXISTS(SELECT 1 FROM "Turn" WHERE "matchId"=key AND "number"=NEW."number"-1 AND "status"='RESOLVED')) THEN RAISE EXCEPTION 'Nonsequential loop turn'; END IF;
   IF NEW."status"<>'OPEN' OR NEW."startingStateVersion"<>NEW."number"-1 OR NEW."lastObservedAtMs"<>NEW."openedAtMs" OR NEW."deadlineAtMs"-NEW."openedAtMs"<>c."turnDurationMs" OR NEW."number">4294967295 THEN RAISE EXCEPTION 'Invalid loop opening'; END IF;
   IF NEW."number"=1 THEN IF m."status"<>'OPEN' THEN RAISE EXCEPTION 'Loop first opening only'; END IF;
   ELSE IF NEW."openedAtMs"<>(SELECT ("payload"->>'nextOpenedAtMs')::bigint FROM "ResolutionResult" WHERE "matchId"=key AND "turnNumber"=NEW."number"-1) THEN RAISE EXCEPTION 'Loop window must bind completed resolution'; END IF; END IF;RETURN NEW;
  END IF;
  IF (NEW."number",NEW."startingStateVersion",NEW."openedAtMs",NEW."deadlineAtMs") IS DISTINCT FROM (OLD."number",OLD."startingStateVersion",OLD."openedAtMs",OLD."deadlineAtMs") OR NEW."lastObservedAtMs"<OLD."lastObservedAtMs" THEN RAISE EXCEPTION 'Loop turn identity/clock immutable'; END IF;
  IF OLD."status"='CLOSED' AND NEW."status"='RESOLVING' OR OLD."status"='RESOLVING' AND NEW."status"='RESOLVED' THEN IF to_jsonb(NEW)-'status' IS DISTINCT FROM to_jsonb(OLD)-'status' THEN RAISE EXCEPTION 'Resolution changes status only'; END IF; RETURN NEW; END IF;
  IF OLD."status"<>'OPEN' OR NEW."status" NOT IN ('OPEN','CLOSED') OR NEW."number"<>m."currentStateVersion"+1 THEN RAISE EXCEPTION 'Loop cannot reopen'; END IF;
  IF NEW."status"='OPEN' AND NEW."lastObservedAtMs">=NEW."deadlineAtMs" THEN RAISE EXCEPTION 'Expired loop must close'; END IF;
  IF NEW."status"='CLOSED' AND NOT((NEW."closeReason"='DEADLINE' AND NEW."closedAtMs"=NEW."deadlineAtMs" AND NEW."lastObservedAtMs">=NEW."deadlineAtMs") OR (NEW."closeReason"='ALL_READY' AND NEW."closedAtMs"=NEW."lastObservedAtMs" AND NEW."lastObservedAtMs"<NEW."deadlineAtMs" AND NOT EXISTS(SELECT 1 FROM "PlayerTurnState" WHERE "matchId"=key AND "turnNumber"=NEW."number" AND NOT "ready"))) THEN RAISE EXCEPTION 'Invalid loop closure'; END IF;RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='FrozenTurnInputRecord' THEN
  SELECT * INTO STRICT t FROM "Turn" WHERE "matchId"=key AND "number"=NEW."turnNumber";
  IF TG_OP<>'INSERT' OR t."status"<>'CLOSED' OR NEW."seed"<>mod((SELECT "seed" FROM "MatchWorld" WHERE "matchId"=key)+NEW."turnNumber"-1,4294967296)
   OR (NEW."payload"->>'seedIdentity'~'^loop-seed:[a-f0-9]{64}$') IS NOT TRUE OR NEW."payload" IS DISTINCT FROM europe_loop_frozen_payload(key,NEW."turnNumber",NEW."payload"->>'seedIdentity') THEN RAISE EXCEPTION 'Loop frozen input mismatch'; END IF;RETURN NEW;
 END IF;
 n:=NEW."turnNumber";SELECT * INTO STRICT t FROM "Turn" WHERE "matchId"=key AND "number"=n;
 IF TG_OP='UPDATE' THEN IF (NEW."turnNumber",NEW."playerId") IS DISTINCT FROM (OLD."turnNumber",OLD."playerId") THEN RAISE EXCEPTION 'Loop draft identity immutable'; END IF; END IF;
 IF TG_TABLE_NAME='PlayerTurnState' AND TG_OP='INSERT' THEN
  IF t."status"<>'OPEN' OR NEW."revision"<>0 OR NEW."ready" OR NOT NEW."active" THEN RAISE EXCEPTION 'Loop drafts start empty unready'; END IF;RETURN NEW;
 END IF;
 SELECT * INTO STRICT p FROM "PlayerTurnState" WHERE "matchId"=key AND "turnNumber"=n AND "playerId"=NEW."playerId";
 IF TG_TABLE_NAME='PlayerSubmissionRevision' THEN IF NEW."kind"='INITIAL' THEN IF TG_OP<>'INSERT' OR p."revision"<>0 OR NEW."revision"<>0 OR NEW."ready" OR NEW."command" IS NOT NULL OR NEW."orders"<>'[]'::jsonb THEN RAISE EXCEPTION 'Invalid loop initial history'; END IF; RETURN NEW; END IF; END IF;
 IF t."status"<>'OPEN' OR n<>m."currentStateVersion"+1 THEN RAISE EXCEPTION 'Loop current OPEN turn required'; END IF;
 clock_ms:=floor(extract(epoch FROM clock_timestamp())*1000);
 IF clock_ms<t."openedAtMs" THEN RAISE EXCEPTION 'Loop clock rollback'; END IF;
 IF clock_ms>=t."deadlineAtMs" THEN RAISE EXCEPTION 'Loop acceptance expired' USING ERRCODE='P0059'; END IF;
 SELECT * INTO STRICT prior FROM "PlayerSubmissionRevision" WHERE "matchId"=key AND "turnNumber"=n AND "playerId"=p."playerId" AND "revision"=p."revision";
 IF TG_TABLE_NAME='PlayerSubmissionRevision' THEN
  IF TG_OP<>'INSERT' OR NEW."revision"<>p."revision"+1 OR (NEW."command"->'schemaVersion'='2'::jsonb AND NEW."command"->'profile'=((c."pinnedRuleset"->'europe')-'maskSha256'||jsonb_build_object('profileId','europe-playtest-v1')) AND NEW."command"->'turnNumber'=to_jsonb(n) AND NEW."command"->'expectedRevision'=to_jsonb(p."revision") AND europe_loop_queue_ok(key,n,p."playerId",NEW."orders")) IS NOT TRUE THEN RAISE EXCEPTION 'Invalid loop revision'; END IF;
  IF NEW."kind"='SET_READY' THEN
   IF (NEW."command"-ARRAY['profile','schemaVersion','turnNumber','expectedRevision','kind','ready']='{}'::jsonb AND NEW."command"->>'kind'='set_ready' AND NEW."command"->'ready'=to_jsonb(NEW."ready") AND NEW."ready"<>p."ready" AND NEW."orders"=prior."orders") IS NOT TRUE THEN RAISE EXCEPTION 'Invalid loop Ready'; END IF;
  ELSE
   IF p."ready" OR NEW."ready" THEN RAISE EXCEPTION 'Loop Ready locks orders'; END IF;
   IF NEW."kind"='REPLACE_ORDERS' THEN IF (NEW."command"-ARRAY['profile','schemaVersion','turnNumber','expectedRevision','kind','orders']='{}'::jsonb AND NEW."command"->>'kind'='replace_orders' AND NEW."command"->'orders'=NEW."orders") IS NOT TRUE THEN RAISE EXCEPTION 'Invalid loop replacement'; END IF;
   ELSIF NEW."kind"='CANCEL_ORDER' THEN
    IF (NEW."command"-ARRAY['profile','schemaVersion','turnNumber','expectedRevision','kind','orderId']='{}'::jsonb AND NEW."command"->>'kind'='cancel_order' AND EXISTS(SELECT 1 FROM jsonb_array_elements(prior."orders") entry WHERE entry->'orderId'=NEW."command"->'orderId')) IS NOT TRUE THEN RAISE EXCEPTION 'Invalid loop cancellation'; END IF;
    SELECT coalesce(jsonb_agg(value ORDER BY ord),'[]'::jsonb) INTO candidate FROM jsonb_array_elements(prior."orders") WITH ORDINALITY q(value,ord) WHERE value->'orderId'<>NEW."command"->'orderId';IF candidate IS DISTINCT FROM NEW."orders" THEN RAISE EXCEPTION 'Loop cancellation must preserve rest'; END IF;
   ELSE RAISE EXCEPTION 'Invalid loop command'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='PlayerTurnState' THEN
  IF TG_OP<>'UPDATE' OR NEW."active" IS DISTINCT FROM OLD."active" OR NEW."revision"<>OLD."revision"+1 OR NOT EXISTS(SELECT 1 FROM "PlayerSubmissionRevision" WHERE "matchId"=key AND "turnNumber"=n AND "playerId"=NEW."playerId" AND "revision"=NEW."revision" AND "ready"=NEW."ready") THEN RAISE EXCEPTION 'Loop CAS requires history'; END IF;
 ELSIF TG_TABLE_NAME='PlayerOrder' THEN
  IF p."ready" OR prior."kind" NOT IN ('REPLACE_ORDERS','CANCEL_ORDER') OR (NEW."kind"='MOVE' AND NEW."lastRevision"=p."revision" AND NEW."orderId"=NEW."payload"->>'orderId' AND europe_loop_queue_ok(key,n,p."playerId",jsonb_build_array(NEW."payload"))) IS NOT TRUE THEN RAISE EXCEPTION 'Invalid loop order'; END IF;
 ELSE RAISE EXCEPTION 'Unknown loop artifact'; END IF;RETURN NEW;
END;
$$;
CREATE FUNCTION europe_loop_match_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "MatchConfiguration" WHERE "matchId"=OLD."id" AND "simulationVersion"='europe-playtest-v1') THEN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR OLD."status"='RUNNING' AND NEW."status"<>'RUNNING' THEN RAISE EXCEPTION 'Loop match sealed'; END IF;
  IF NEW."currentStateVersion" IS DISTINCT FROM OLD."currentStateVersion" AND (NEW."currentStateVersion"<>OLD."currentStateVersion"+1 OR NOT EXISTS(SELECT 1 FROM "Turn" WHERE "matchId"=NEW."id" AND "number"=NEW."currentStateVersion" AND "status"='RESOLVED')) THEN RAISE EXCEPTION 'Loop advances sequentially once'; END IF;
 END IF;RETURN NEW;
END;
$$;
CREATE FUNCTION europe_loop_bundle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key text; m "Match"; c "MatchConfiguration"; t "Turn"; s jsonb; previous jsonb; next_state jsonb; result jsonb; receipt jsonb; p "PlayerTurnState"; latest "PlayerSubmissionRevision"; n bigint; u jsonb; f jsonb; original jsonb; city jsonb; active_orders jsonb; clock_ms bigint; actor text;
BEGIN
 IF TG_TABLE_NAME='Match' THEN key:=NEW."id"; ELSE key:=NEW."matchId"; END IF;
 SELECT * INTO m FROM "Match" WHERE "id"=key;IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO c FROM "MatchConfiguration" WHERE "matchId"=key;
 IF (c."simulationVersion"='europe-playtest-v1') IS NOT TRUE THEN RETURN NULL; END IF;
 IF m."status"<>'RUNNING' OR NOT europe_loop_profile_ok(c) OR m."currentStateVersion" NOT BETWEEN 0 AND 4294967294 THEN RAISE EXCEPTION 'Loop bundle requires supported running match'; END IF;
 IF (SELECT count(*) FROM "Turn" WHERE "matchId"=key)<>m."currentStateVersion"+1
  OR (SELECT count(*) FROM "GameSnapshotRecord" WHERE "matchId"=key)<>m."currentStateVersion"+1
  OR (SELECT count(*) FROM "ResolutionResult" WHERE "matchId"=key)<>m."currentStateVersion"
  OR (SELECT count(*) FROM "Turn" WHERE "matchId"=key AND "status" IN ('OPEN','CLOSED'))<>1
  OR EXISTS(SELECT 1 FROM "Turn" WHERE "matchId"=key AND ("number"<1 OR "number">m."currentStateVersion"+1 OR "startingStateVersion"<>"number"-1 OR ("number"<=m."currentStateVersion" AND "status"<>'RESOLVED') OR ("number"=m."currentStateVersion"+1 AND "status" NOT IN ('OPEN','CLOSED')))) THEN RAISE EXCEPTION 'Loop atomic sequential turn bundle incomplete'; END IF;
 IF TG_TABLE_NAME='Match' THEN n:=1;
 ELSIF TG_TABLE_NAME='GameSnapshotRecord' THEN n:=greatest(1,NEW."stateVersion");
 ELSIF TG_TABLE_NAME='Turn' THEN n:=NEW."number";
 ELSE n:=NEW."turnNumber"; END IF;
 -- Turn has number rather than turnNumber; the table-specific branch must be first.
 SELECT * INTO STRICT t FROM "Turn" WHERE "matchId"=key AND "number"=n;
 SELECT "payload" INTO STRICT s FROM "GameSnapshotRecord" WHERE "matchId"=key AND "stateVersion"=n-1;
 IF (s->'schemaVersion'='11'::jsonb AND s->>'kind'='europe_loop_state' AND s->'stateVersion'=to_jsonb(n-1) AND s->'completedTurnNumber'=to_jsonb(n-1)
  AND s->'config'=c."config" AND s->'ruleset'=c."pinnedRuleset"->'ruleset' AND s->>'simulationVersion'=c."simulationVersion"
  AND jsonb_typeof(s->'units')='array' AND jsonb_typeof(s->'formations')='array' AND jsonb_typeof(s->'cityOwners')='array' AND combat_policy_ok(s->'combatPolicy',s->'players')) IS NOT TRUE THEN RAISE EXCEPTION 'Invalid loop starting state'; END IF;
 IF n=1 THEN
  IF (SELECT count(*) FROM "MatchParticipant" WHERE "matchId"=key AND "active")<>jsonb_array_length(s->'players') OR jsonb_array_length(s->'units')<>6*jsonb_array_length(s->'players') OR jsonb_array_length(s->'formations')<>jsonb_array_length(s->'players') OR s->'predecessorResolutionId'<>'null'::jsonb THEN RAISE EXCEPTION 'Invalid loop genesis roster'; END IF;
 ELSE
  SELECT "payload" INTO STRICT receipt FROM "ResolutionResult" WHERE "matchId"=key AND "turnNumber"=n-1;
  IF s IS DISTINCT FROM receipt#>'{result,nextState}' OR t."openedAtMs"<>(receipt->>'nextOpenedAtMs')::bigint THEN RAISE EXCEPTION 'Loop predecessor/starting state mismatch'; END IF;
 END IF;
 IF t."deadlineAtMs"-t."openedAtMs"<>c."turnDurationMs" OR t."lastObservedAtMs"<t."openedAtMs" THEN RAISE EXCEPTION 'Loop window changed'; END IF;
 IF TG_TABLE_NAME IN ('PlayerTurnState','PlayerSubmissionRevision','PlayerOrder') THEN actor:=NEW."playerId"; ELSE actor:=NULL; END IF;
 FOR p IN SELECT * FROM "PlayerTurnState" WHERE "matchId"=key AND "turnNumber"=n AND (actor IS NULL OR "playerId"=actor) LOOP
  IF NOT p."active" OR NOT EXISTS(SELECT 1 FROM "MatchParticipant" WHERE "matchId"=key AND "playerId"=p."playerId" AND "active") OR (SELECT count(*) FROM "PlayerSubmissionRevision" WHERE "matchId"=key AND "turnNumber"=n AND "playerId"=p."playerId")<>p."revision"+1 THEN RAISE EXCEPTION 'Loop revision gap/roster mismatch'; END IF;
  SELECT * INTO STRICT latest FROM "PlayerSubmissionRevision" WHERE "matchId"=key AND "turnNumber"=n AND "playerId"=p."playerId" AND "revision"=p."revision";
  SELECT coalesce(jsonb_agg("payload" ORDER BY "draftPosition"),'[]'::jsonb) INTO active_orders FROM "PlayerOrder" WHERE "matchId"=key AND "turnNumber"=n AND "playerId"=p."playerId" AND "active";
  IF p."ready"<>latest."ready" OR active_orders IS DISTINCT FROM latest."orders" OR NOT europe_loop_queue_ok(key,n,p."playerId",latest."orders") THEN RAISE EXCEPTION 'Loop latest draft mismatch'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM "PlayerTurnState" WHERE "matchId"=key AND "turnNumber"=n)<>jsonb_array_length(s->'players') THEN RAISE EXCEPTION 'Loop next turn missing participants'; END IF;
 IF t."status"='OPEN' THEN
  IF EXISTS(SELECT 1 FROM "FrozenTurnInputRecord" WHERE "matchId"=key AND "turnNumber"=n) OR NOT EXISTS(SELECT 1 FROM "PlayerTurnState" WHERE "matchId"=key AND "turnNumber"=n AND NOT "ready") THEN RAISE EXCEPTION 'Invalid loop OPEN state'; END IF;
 ELSE IF NOT EXISTS(SELECT 1 FROM "FrozenTurnInputRecord" WHERE "matchId"=key AND "turnNumber"=n AND "payload"=europe_loop_frozen_payload(key,n,"payload"->>'seedIdentity')) THEN RAISE EXCEPTION 'Loop closed requires exact frozen input'; END IF;END IF;
 IF t."status"='RESOLVED' THEN
  SELECT "payload" INTO STRICT receipt FROM "ResolutionResult" WHERE "matchId"=key AND "turnNumber"=n;result:=receipt->'result';next_state:=result->'nextState';
  IF result->'startingSnapshotId' IS DISTINCT FROM s->'snapshotId' OR result->'runtimeProfile' IS DISTINCT FROM c."pinnedRuleset" OR next_state->'predecessorResolutionId' IS DISTINCT FROM result->'resolutionId'
   OR NOT EXISTS(SELECT 1 FROM "GameSnapshotRecord" WHERE "matchId"=key AND "stateVersion"=n AND "payload"=next_state)
   OR NOT EXISTS(SELECT 1 FROM "Turn" WHERE "matchId"=key AND "number"=n+1 AND "startingStateVersion"=n AND "openedAtMs"=(receipt->>'nextOpenedAtMs')::bigint AND "deadlineAtMs"="openedAtMs"+c."turnDurationMs") THEN RAISE EXCEPTION 'Loop complete result/successor missing'; END IF;
  IF next_state-ARRAY['snapshotId','stateVersion','completedTurnNumber','predecessorResolutionId','units','formations','cityOwners'] IS DISTINCT FROM s-ARRAY['snapshotId','stateVersion','completedTurnNumber','predecessorResolutionId','units','formations','cityOwners'] THEN RAISE EXCEPTION 'Loop policy/config/provenance state changed'; END IF;
  IF jsonb_typeof(next_state->'units') IS DISTINCT FROM 'array' OR jsonb_typeof(next_state->'formations') IS DISTINCT FROM 'array' OR jsonb_typeof(next_state->'cityOwners') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Missing loop survivor arrays'; END IF;
  FOR u IN SELECT value FROM jsonb_array_elements(next_state->'units') LOOP
   SELECT value INTO STRICT original FROM jsonb_array_elements(s->'units') WHERE value->'unitId'=u->'unitId';
   IF u-'hp' IS DISTINCT FROM original-'hp' OR jsonb_typeof(u->'hp') IS DISTINCT FROM 'number' OR (u->>'hp')::numeric<>trunc((u->>'hp')::numeric) OR (u->>'hp')::numeric NOT BETWEEN 1 AND (u->>'maxHp')::numeric THEN RAISE EXCEPTION 'Loop unit resurrection or mutation'; END IF;
  END LOOP;
  FOR f IN SELECT value FROM jsonb_array_elements(next_state->'formations') LOOP
   SELECT value INTO STRICT original FROM jsonb_array_elements(s->'formations') WHERE value->'formationId'=f->'formationId';
   IF f-ARRAY['unitIds','position'] IS DISTINCT FROM original-ARRAY['unitIds','position'] OR jsonb_typeof(f->'unitIds') IS DISTINCT FROM 'array' OR jsonb_array_length(f->'unitIds')=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(f->'unitIds') member WHERE NOT (original->'unitIds') @> jsonb_build_array(member) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(next_state->'units') unit WHERE unit->'unitId'=member AND unit->'ownerPlayerId'=f->'ownerPlayerId')) THEN RAISE EXCEPTION 'Invalid loop final membership'; END IF;
   IF (jsonb_typeof(f#>'{position,xMilli}')='number' AND jsonb_typeof(f#>'{position,yMilli}')='number' AND (f->'position')-ARRAY['xMilli','yMilli']='{}'::jsonb) IS NOT TRUE
    OR (f#>>'{position,xMilli}')::numeric<>trunc((f#>>'{position,xMilli}')::numeric) OR (f#>>'{position,yMilli}')::numeric<>trunc((f#>>'{position,yMilli}')::numeric)
    OR (f#>>'{position,xMilli}')::numeric NOT BETWEEN 0 AND (SELECT ("payload"#>>'{bounds,width}')::numeric*1000 FROM "MatchWorld" WHERE "matchId"=key)
    OR (f#>>'{position,yMilli}')::numeric NOT BETWEEN 0 AND (SELECT ("payload"#>>'{bounds,height}')::numeric*1000 FROM "MatchWorld" WHERE "matchId"=key) THEN RAISE EXCEPTION 'Invalid loop final position'; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value->'unitId') FROM jsonb_array_elements(next_state->'units'))<>jsonb_array_length(next_state->'units') OR (SELECT count(*) FROM jsonb_array_elements(next_state->'formations') form,jsonb_array_elements(form->'unitIds'))<>jsonb_array_length(next_state->'units') OR (SELECT count(DISTINCT member) FROM jsonb_array_elements(next_state->'formations') form,jsonb_array_elements(form->'unitIds') member)<>jsonb_array_length(next_state->'units') THEN RAISE EXCEPTION 'Loop surviving membership must be unique complete'; END IF;
  IF jsonb_array_length(next_state->'cityOwners')<>jsonb_array_length(s->'cityOwners') OR (SELECT count(DISTINCT value->'cityId') FROM jsonb_array_elements(next_state->'cityOwners'))<>jsonb_array_length(s->'cityOwners') THEN RAISE EXCEPTION 'Loop city set changed'; END IF;
  FOR city IN SELECT value FROM jsonb_array_elements(next_state->'cityOwners') LOOP
   SELECT value INTO STRICT original FROM jsonb_array_elements(s->'cityOwners') WHERE value->'cityId'=city->'cityId';
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s->'players') player WHERE player->'playerId'=city->'ownerPlayerId') OR city-ARRAY['cityId','ownerPlayerId']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid loop city owner'; END IF;
   IF city->'ownerPlayerId' IS DISTINCT FROM original->'ownerPlayerId' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'battles') battle WHERE battle->'locationId'=city->'cityId' AND battle->'recipientPlayerId'=city->'ownerPlayerId' AND battle->>'outcome'='victory') THEN RAISE EXCEPTION 'Loop capture requires complete victorious recipient'; END IF;
  END LOOP;
 END IF;
 -- Commit-time late acceptance never gets a hidden extension. Fresh initial drafts
 -- and deadline closure are allowed; a newly opened successor must still be fresh.
 clock_ms:=floor(extract(epoch FROM clock_timestamp())*1000);
 IF t."status"='OPEN' AND n>1 AND t."openedAtMs">clock_ms THEN RAISE EXCEPTION 'Loop future opening'; END IF;
 IF t."status"='OPEN' AND (n>1 OR EXISTS(SELECT 1 FROM "PlayerTurnState" WHERE "matchId"=key AND "turnNumber"=n AND "revision">0)) AND clock_ms>=t."deadlineAtMs" THEN RAISE EXCEPTION 'Loop commit window expired' USING ERRCODE='P0059'; END IF;
 IF t."status"='CLOSED' AND t."closeReason"='ALL_READY' AND clock_ms>=t."deadlineAtMs" THEN RAISE EXCEPTION 'Loop Ready commit expired' USING ERRCODE='P0059'; END IF;
 RETURN NULL;
END;
$$;
CREATE TRIGGER europe_loop_guard_matchconfiguration BEFORE INSERT ON "MatchConfiguration" FOR EACH ROW EXECUTE FUNCTION europe_loop_guard();
CREATE TRIGGER europe_loop_guard_matchworld BEFORE INSERT OR UPDATE OR DELETE ON "MatchWorld" FOR EACH ROW EXECUTE FUNCTION europe_loop_guard();
CREATE TRIGGER europe_loop_guard_matchparticipant BEFORE INSERT OR UPDATE OR DELETE ON "MatchParticipant" FOR EACH ROW EXECUTE FUNCTION europe_loop_guard();
CREATE TRIGGER europe_loop_guard_gamesnapshotrecord BEFORE INSERT OR UPDATE OR DELETE ON "GameSnapshotRecord" FOR EACH ROW EXECUTE FUNCTION europe_loop_guard();
CREATE TRIGGER europe_loop_guard_turn BEFORE INSERT OR UPDATE OR DELETE ON "Turn" FOR EACH ROW EXECUTE FUNCTION europe_loop_guard();
CREATE TRIGGER europe_loop_guard_playerturnstate BEFORE INSERT OR UPDATE OR DELETE ON "PlayerTurnState" FOR EACH ROW EXECUTE FUNCTION europe_loop_guard();
CREATE TRIGGER europe_loop_guard_playersubmissionrevision BEFORE INSERT OR UPDATE OR DELETE ON "PlayerSubmissionRevision" FOR EACH ROW EXECUTE FUNCTION europe_loop_guard();
CREATE TRIGGER europe_loop_guard_playerorder BEFORE INSERT OR UPDATE OR DELETE ON "PlayerOrder" FOR EACH ROW EXECUTE FUNCTION europe_loop_guard();
CREATE TRIGGER europe_loop_guard_frozenturninputrecord BEFORE INSERT OR UPDATE OR DELETE ON "FrozenTurnInputRecord" FOR EACH ROW EXECUTE FUNCTION europe_loop_guard();
CREATE TRIGGER europe_loop_guard_resolutionresult BEFORE INSERT OR UPDATE OR DELETE ON "ResolutionResult" FOR EACH ROW EXECUTE FUNCTION europe_loop_guard();
CREATE TRIGGER europe_loop_guard_orderdependency BEFORE INSERT OR UPDATE OR DELETE ON "OrderDependency" FOR EACH ROW EXECUTE FUNCTION europe_loop_guard();
CREATE TRIGGER europe_loop_match BEFORE UPDATE ON "Match" FOR EACH ROW EXECUTE FUNCTION europe_loop_match_guard();
CREATE CONSTRAINT TRIGGER europe_loop_complete_gamesnapshotrecord AFTER INSERT OR UPDATE ON "GameSnapshotRecord" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION europe_loop_bundle();
CREATE CONSTRAINT TRIGGER europe_loop_complete_turn AFTER INSERT OR UPDATE ON "Turn" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION europe_loop_bundle();
CREATE CONSTRAINT TRIGGER europe_loop_complete_playerturnstate AFTER INSERT OR UPDATE ON "PlayerTurnState" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION europe_loop_bundle();
CREATE CONSTRAINT TRIGGER europe_loop_complete_playersubmissionrevision AFTER INSERT OR UPDATE ON "PlayerSubmissionRevision" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION europe_loop_bundle();
CREATE CONSTRAINT TRIGGER europe_loop_complete_playerorder AFTER INSERT OR UPDATE ON "PlayerOrder" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION europe_loop_bundle();
CREATE CONSTRAINT TRIGGER europe_loop_complete_frozenturninputrecord AFTER INSERT OR UPDATE ON "FrozenTurnInputRecord" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION europe_loop_bundle();
CREATE CONSTRAINT TRIGGER europe_loop_complete_resolutionresult AFTER INSERT OR UPDATE ON "ResolutionResult" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION europe_loop_bundle();
CREATE CONSTRAINT TRIGGER europe_loop_started AFTER UPDATE ON "Match" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW."status"='RUNNING') EXECUTE FUNCTION europe_loop_bundle();
CREATE OR REPLACE FUNCTION require_initial_turn_bundle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key text; m "Match"; c "MatchConfiguration"; w "MatchWorld"; s "GameSnapshotRecord"; t "Turn"; n integer;
BEGIN
  IF TG_TABLE_NAME = 'Match' THEN key := NEW."id"; ELSE key := NEW."matchId"; END IF;
  SELECT * INTO m FROM "Match" WHERE "id" = key;
  IF NOT FOUND THEN RETURN NULL; END IF; -- Only complete parent-match cascade cleanup.
  SELECT * INTO c FROM "MatchConfiguration" WHERE "matchId" = key;
  IF TG_TABLE_NAME = 'Match' AND (c."matchId" IS NULL OR NOT (
    (c."rulesetId" IS NULL AND c."rulesetVersion" IS NULL AND c."simulationVersion" IS NULL AND c."pinnedRuleset" IS NULL)
    OR initial_turn_profile_ok(c) OR initial_armies_profile_ok(c) OR movement_drafts_profile_ok(c) OR turn_closure_profile_ok(c) OR movement_resolution_profile_ok(c) OR combat_movement_resolution_profile_ok(c) OR loop_profile_ok(c) OR europe_loop_profile_ok(c))) THEN RAISE EXCEPTION 'Unsupported lobby start runtime'; END IF;
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

CREATE FUNCTION europe_loop_delete_children() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."status"='RUNNING' AND EXISTS(SELECT 1 FROM "MatchConfiguration" WHERE "matchId"=OLD."id" AND "simulationVersion"='europe-playtest-v1') THEN
 DELETE FROM "ResolutionResult" WHERE "matchId"=OLD."id";
 DELETE FROM "FrozenTurnInputRecord" WHERE "matchId"=OLD."id";
 DELETE FROM "OrderDependency" WHERE "matchId"=OLD."id";
 DELETE FROM "PlayerOrder" WHERE "matchId"=OLD."id";
 DELETE FROM "PlayerSubmissionRevision" WHERE "matchId"=OLD."id";
 DELETE FROM "PlayerTurnState" WHERE "matchId"=OLD."id";
 DELETE FROM "Turn" WHERE "matchId"=OLD."id";
 DELETE FROM "GameSnapshotRecord" WHERE "matchId"=OLD."id";
 END IF;RETURN OLD;
END;
$$;
CREATE TRIGGER "A_europe_loop_cascade" AFTER DELETE ON "Match" FOR EACH ROW EXECUTE FUNCTION europe_loop_delete_children();
COMMIT;
