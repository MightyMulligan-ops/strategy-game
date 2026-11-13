import { describe, expect, it, vi } from "vitest";
import { MOVEMENT_DRAFT_RUNTIME_PROFILE, INITIAL_ARMIES_RUNTIME_PROFILE, INITIAL_WORLD_RUNTIME_PROFILE } from "@strategy-game/shared-types/server";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { LobbyRepository } from "../src/lobby-repository.js";
import { initialTurnFixture } from "./initial-turn-fixture.js";

describe("trusted creation-time runtime selection (database-free)", () => {
  it.each(["default", "explicit-armies", "explicit-drafts"])("pins only new configuration for %s callers", async (mode) => {
    const row = initialTurnFixture().row.match;
    row.status = "OPEN";
    const profile = mode === "default" ? INITIAL_WORLD_RUNTIME_PROFILE : mode === "explicit-drafts" ? MOVEMENT_DRAFT_RUNTIME_PROFILE : INITIAL_ARMIES_RUNTIME_PROFILE;
    const configuration = vi.fn(async ({ data }: { data: typeof row.configuration }) => { row.configuration = data; });
    const tx = { playerIdentity: { findUnique: async () => ({ username: "Player0" }) },
      match: { create: async ({ data }: { data: { id: string } }) => { row.id = data.id; }, findUnique: async () => ({ ...row,
        participants: [{ playerId: "match-local", identityId: "account-p00", lobbyReady: false, identity: { username: "Player0" } }] }) },
      matchConfiguration: { create: configuration }, matchParticipant: { create: vi.fn() } };
    const client = { $transaction: async (work: (t: typeof tx) => unknown) => work(tx) } as unknown as PrismaClient;
    const repo = mode === "default" ? new LobbyRepository(client) : new LobbyRepository(client, undefined, undefined, profile);
    const result = await repo.createLobby("account-p00", { name: "Starting armies", playerCapacity: 2, turnDurationMs: 1000, visibility: "PUBLIC" });
    expect(result.status).toBe("OPEN"); expect(row.configuration).toMatchObject({ matchId: row.id, pinnedRuleset: profile,
      rulesetId: profile.ruleset.rulesetId, rulesetVersion: profile.ruleset.version, simulationVersion: profile.simulationVersion });
    expect(configuration).toHaveBeenCalledOnce(); expect(tx.matchParticipant.create).toHaveBeenCalledOnce();
    await expect(repo.createLobby("account-p00", { name: "Untrusted", playerCapacity: 2, turnDurationMs: 1000, visibility: "PUBLIC", runtime: "initial-armies-v1" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(configuration).toHaveBeenCalledOnce();
  });
});
