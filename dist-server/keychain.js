import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const VAULT_ACCOUNT = "vault.v1";
let vaultCache;
function helperExecutable() {
    const candidates = [process.env.OMB_KEYCHAIN_HELPER, resolve("electron/resources/keychain-helper")].filter((value) => Boolean(value));
    return candidates.find((value) => existsSync(value));
}
export function keychainEnabled() {
    return process.platform === "darwin" && Boolean(helperExecutable()) && process.env.OMB_DISABLE_KEYCHAIN !== "1" && !process.env.VITEST;
}
export function secretAccount(section, field, id) {
    const safe = [section, id, field].filter(Boolean).join(".").replace(/[^A-Za-z0-9._-]/g, "-");
    return safe.slice(0, 220);
}
export function parseSecretVault(value) {
    try {
        const parsed = JSON.parse(value);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            return {};
        return Object.fromEntries(Object.entries(parsed).filter(([account, secret]) => /^[A-Za-z0-9._-]{1,220}$/.test(account) && typeof secret === "string" && secret.length > 0 && secret.length <= 1_000_000));
    }
    catch {
        return {};
    }
}
function helper(operation, account, input) {
    return spawnSync(helperExecutable(), [operation, account], {
        input,
        encoding: "utf8",
        timeout: 15_000,
        stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"],
    });
}
function vault() {
    if (vaultCache)
        return vaultCache;
    if (!keychainEnabled())
        return {};
    const result = helper("get", VAULT_ACCOUNT);
    vaultCache = result.status === 0 ? parseSecretVault(result.stdout) : {};
    return vaultCache;
}
function saveVault(next) {
    const encoded = JSON.stringify(next);
    if (Buffer.byteLength(encoded, "utf8") > 1_000_000)
        return false;
    const result = helper("set", VAULT_ACCOUNT, encoded);
    if (result.status !== 0)
        return false;
    vaultCache = next;
    return true;
}
/**
 * Consolidate legacy one-item-per-secret records into one Keychain item.
 * This is intentionally called once before config hydration. The new vault is
 * written before any legacy item is deleted, so a cancelled prompt or failed
 * write cannot lose credentials.
 */
export function migrateLegacyKeychainSecrets(accounts) {
    if (!keychainEnabled())
        return false;
    const current = vault();
    const unique = [...new Set(accounts)].filter((account) => account !== VAULT_ACCOUNT);
    const migrated = [];
    const next = { ...current };
    for (const account of unique) {
        if (next[account])
            continue;
        const result = helper("get", account);
        if (result.status === 0 && result.stdout) {
            next[account] = result.stdout;
            migrated.push(account);
        }
    }
    if (!migrated.length)
        return true;
    if (!saveVault(next))
        return false;
    for (const account of migrated)
        helper("delete", account);
    return true;
}
export function readKeychainSecret(account) {
    if (!keychainEnabled())
        return undefined;
    return vault()[account] || undefined;
}
export function writeKeychainSecret(account, value) {
    if (!keychainEnabled())
        return false;
    if (!value)
        return deleteKeychainSecret(account);
    const current = vault();
    return saveVault({ ...current, [account]: value });
}
export function deleteKeychainSecret(account) {
    if (!keychainEnabled())
        return false;
    const current = vault();
    if (!(account in current))
        return true;
    const next = { ...current };
    delete next[account];
    return saveVault(next);
}
