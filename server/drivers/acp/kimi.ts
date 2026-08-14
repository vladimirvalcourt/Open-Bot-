// Kimi Code CLI over ACP, bound exclusively to Moonshot's official Kimi
// account OAuth flow. `kimi login` owns the device-code browser login and
// writes credentials beneath an app-isolated KIMI_CODE_HOME; OpenMausBot
// never reads, copies, or stores the OAuth token itself.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { createAcpDriver, type AcpSupport } from "./core.ts";

const KIMI_HOME = join(homedir(), ".openmausbot", "providers", "kimi-code");

const support: AcpSupport = {
  driverKind: "kimiAgent",
  displayName: "Kimi Code",
  // The managed service provisions its account-specific model catalog after
  // login. Keep one stable app choice and let the official CLI bind it.
  models: { default: "kimi-code", options: [{ id: "kimi-code", label: "Kimi Code" }] },
  defaultCli: "kimi",
  nativeSource: "kimi.acp",
  loginNote: "Kimi Code could not sign in — run `kimi login` and authorize your Kimi account",

  spawnArgs: () => ["acp"],
  transformEnv: (env) => {
    env.KIMI_CODE_HOME = KIMI_HOME;
    // Never allow ambient pay-as-you-go credentials to change this provider's
    // billing path. The isolated home also excludes API-key config from the
    // user's ordinary ~/.kimi-code installation.
    for (const key of [
      "KIMI_API_KEY",
      "MOONSHOT_API_KEY",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GEMINI_API_KEY",
      "GOOGLE_API_KEY",
    ]) {
      delete env[key];
    }
  },
  pickAuthMethod: (methods) => (methods.some((method) => method.id === "login") ? "login" : null),
  authRecoveryArgs: () => ["login"],
  authFailure: "fail",
  isAuthenticated: () => existsSync(join(KIMI_HOME, "credentials", "kimi-code.json")),
  buildPromptText: (turn) => (turn.system ? `${turn.system}\n\n${turn.text}` : turn.text),
};

export const KimiAgentDriver = createAcpDriver(support);
