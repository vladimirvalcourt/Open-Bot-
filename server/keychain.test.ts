import { describe, expect, it } from "vitest";
import { parseSecretVault, secretAccount } from "./keychain.ts";

describe("keychain secret account names", () => {
  it("creates stable, shell-independent identifiers", () => {
    expect(secretAccount("codespaces", "token")).toBe("codespaces.token");
    expect(secretAccount("apiProviders", "apiKey", "provider / one")).toBe("apiProviders.provider---one.apiKey");
  });
});

describe("keychain vault parsing", () => {
  it("keeps only bounded string secrets with safe account names", () => {
    expect(parseSecretVault(JSON.stringify({
      "codespaces.token": "secret",
      "bad account": "drop",
      "box.token": 42,
      "empty.token": "",
    }))).toEqual({ "codespaces.token": "secret" });
  });

  it("fails closed on malformed vault data", () => {
    expect(parseSecretVault("not-json")).toEqual({});
    expect(parseSecretVault("[]")).toEqual({});
  });
});
