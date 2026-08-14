// Gemini CLI harness support — Google's `gemini` CLI over ACP stdio
// (`gemini --acp`). Rides the generic runtime in acp/core.ts.
//
// The provider is deliberately subscription/account-first. ACP's
// `oauth-personal` method opens Google's browser login and reuses the cached
// Google account on later turns. We never silently choose `gemini-api-key`:
// API billing is a separate product and is not what this driver promises.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createAcpDriver } from "./core.js";
const GOOGLE_ACCOUNT_AUTH = "oauth-personal";
function selectedGoogleAccountAuth() {
    try {
        const settings = JSON.parse(readFileSync(join(homedir(), ".gemini", "settings.json"), "utf8"));
        return settings?.security?.auth?.selectedType === GOOGLE_ACCOUNT_AUTH;
    }
    catch {
        return false;
    }
}
const support = {
    driverKind: "geminiAgent",
    displayName: "Gemini",
    models: {
        // Official CLI aliases let Google's account-aware router choose models
        // actually enabled for this subscription instead of hard-coding a stale
        // preview/model id.
        default: "auto",
        options: [
            { id: "auto", label: "Auto" },
            { id: "pro", label: "Pro" },
            { id: "flash", label: "Flash" },
        ],
    },
    defaultCli: "gemini",
    nativeSource: "gemini.acp",
    loginNote: "Gemini CLI could not sign in with Google — run `gemini` once and choose Sign in with Google",
    spawnArgs: (_config, turn) => ["--acp", ...(turn.model ? ["-m", turn.model] : [])],
    // Keep this driver on the fixed-price Google-account path even when the
    // parent shell happens to export pay-as-you-go credentials.
    transformEnv: (env) => {
        delete env.GEMINI_API_KEY;
        delete env.GOOGLE_API_KEY;
        delete env.GOOGLE_GENAI_USE_VERTEXAI;
    },
    pickAuthMethod: (methods) => methods.some((method) => method.id === GOOGLE_ACCOUNT_AUTH) ? GOOGLE_ACCOUNT_AUTH : null,
    authFailure: "fail",
    // New Gemini CLI releases keep OAuth tokens in the OS credential store;
    // settings records the chosen mechanism without exposing a token. Keep the
    // legacy file check for users upgrading from older releases.
    isAuthenticated: () => selectedGoogleAccountAuth() || existsSync(join(homedir(), ".gemini", "oauth_creds.json")),
    buildPromptText: (turn) => (turn.system ? `${turn.system}\n\n${turn.text}` : turn.text),
};
export const GeminiAgentDriver = createAcpDriver(support);
