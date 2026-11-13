-- Additive commit-time checkpoint. Keep previously committed migration files unchanged.
BEGIN;
CREATE FUNCTION guard_closure_commit_window() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "MatchConfiguration"; t "Turn";
BEGIN
  -- All attached row shapes have matchId; no table-specific NEW fields are referenced.
  IF NOT EXISTS (SELECT 1 FROM "Match" WHERE "id"=NEW."matchId") THEN RETURN NULL; END IF;
  SELECT * INTO c FROM "MatchConfiguration" WHERE "matchId"=NEW."matchId";
  IF (c."simulationVersion"='turn-closure-v1') IS NOT TRUE THEN RETURN NULL; END IF;
  SELECT * INTO STRICT t FROM "Turn" WHERE "matchId"=NEW."matchId" AND "number"=1;
  -- Expired initialization with revision-zero drafts remains valid. Deadline closure
  -- is also valid; it must freeze only drafts committed by earlier transactions.
  IF t."status"='CLOSED' AND t."closeReason"='DEADLINE' THEN RETURN NULL; END IF;
  IF (t."closeReason"='ALL_READY' OR EXISTS (SELECT 1 FROM "PlayerTurnState" WHERE "matchId"=NEW."matchId" AND "revision">0))
    AND floor(extract(epoch FROM clock_timestamp())*1000)>=t."deadlineAtMs" THEN
    RAISE EXCEPTION 'Closure acceptance window expired at commit' USING ERRCODE='P0059';
  END IF;
  RETURN NULL;
END;
$$;
-- Sort after the cohort completeness/audit triggers for each deferred row event.
CREATE CONSTRAINT TRIGGER zz_closure_commit_history AFTER INSERT ON "PlayerSubmissionRevision" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_closure_commit_window();
CREATE CONSTRAINT TRIGGER zz_closure_commit_player AFTER INSERT OR UPDATE ON "PlayerTurnState" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_closure_commit_window();
CREATE CONSTRAINT TRIGGER zz_closure_commit_order AFTER INSERT OR UPDATE ON "PlayerOrder" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_closure_commit_window();
CREATE CONSTRAINT TRIGGER zz_closure_commit_turn AFTER INSERT OR UPDATE ON "Turn" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_closure_commit_window();
CREATE CONSTRAINT TRIGGER zz_closure_commit_frozen AFTER INSERT ON "FrozenTurnInputRecord" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_closure_commit_window();
COMMIT;
