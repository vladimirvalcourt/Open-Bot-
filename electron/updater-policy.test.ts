import { describe, expect, it } from "vitest";
import { OFFICIAL_UPDATE_TEAM_ID, teamIdentifierFromCodesign, updatePolicy } from "./updater-policy.mjs";

describe("updater signer policy", () => {
  it("allows the official publishing team", () => {
    expect(updatePolicy(OFFICIAL_UPDATE_TEAM_ID)).toEqual({ enabled: true });
  });
  it("disables local and unsigned builds", () => {
    expect(updatePolicy("U8LRLPXCF4")).toMatchObject({ enabled: false });
    expect(updatePolicy(null)).toMatchObject({ enabled: false });
  });
  it("extracts the team identifier from codesign output", () => {
    expect(teamIdentifierFromCodesign("Authority=Apple\nTeamIdentifier=993D98NH4J\nRuntime Version=26")).toBe("993D98NH4J");
  });
});
