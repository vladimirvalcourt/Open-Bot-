import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { DATA_DIR } from "./config.js";
const MAX_BACKUP_BYTES = 120 * 1024 * 1024;
const SAFE_FILE = /^(?:bots\.json(?:\.bak)?|messages-[A-Za-z0-9-]+\.json|work\.json|routines\.json|memory\.json|projects\.json|governance\.json|attachments\/[A-Za-z0-9._ -]+|events\/[A-Za-z0-9._-]+|deleted\/[A-Za-z0-9._-]+)$/;
function filesUnder(root) {
    const output = [];
    const visit = (dir) => {
        let entries = [];
        try {
            entries = readdirSync(dir);
        }
        catch {
            return;
        }
        for (const name of entries) {
            const path = join(dir, name);
            let stat;
            try {
                stat = statSync(path);
            }
            catch {
                continue;
            }
            if (stat.isDirectory())
                visit(path);
            else if (stat.isFile())
                output.push(path);
        }
    };
    visit(root);
    return output;
}
function key(passphrase, salt) {
    if (passphrase.length < 10)
        throw Object.assign(new Error("backup passphrase must be at least 10 characters"), { status: 400 });
    return scryptSync(passphrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
export function createEncryptedBackup(passphrase) {
    const files = [];
    let bytes = 0;
    for (const absolute of filesUnder(DATA_DIR)) {
        const path = relative(DATA_DIR, absolute).split(sep).join("/");
        if (!SAFE_FILE.test(path))
            continue;
        const data = readFileSync(absolute);
        bytes += data.length;
        if (bytes > MAX_BACKUP_BYTES)
            throw Object.assign(new Error("backup exceeds the 120 MB local limit"), { status: 413 });
        files.push({ path, data: data.toString("base64") });
    }
    const payload = Buffer.from(JSON.stringify({ version: 1, createdAt: Date.now(), files }));
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key(passphrase, salt), iv);
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
    return {
        format: "openmausbot-encrypted-backup", version: 1, createdAt: Date.now(), algorithm: "aes-256-gcm+scrypt",
        salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64"),
    };
}
export function restoreEncryptedBackup(envelope, passphrase) {
    if (envelope?.format !== "openmausbot-encrypted-backup" || envelope.version !== 1)
        throw Object.assign(new Error("unsupported backup format"), { status: 400 });
    let payload;
    try {
        const salt = Buffer.from(envelope.salt, "base64");
        const iv = Buffer.from(envelope.iv, "base64");
        const decipher = createDecipheriv("aes-256-gcm", key(passphrase, salt), iv);
        decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
        payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8"));
    }
    catch {
        throw Object.assign(new Error("backup could not be decrypted; check the file and passphrase"), { status: 400 });
    }
    if (!Array.isArray(payload?.files) || payload.files.length > 10_000)
        throw Object.assign(new Error("backup file list is invalid"), { status: 400 });
    let bytes = 0;
    let restored = 0;
    for (const item of payload.files) {
        const path = String(item?.path ?? "");
        if (!SAFE_FILE.test(path))
            throw Object.assign(new Error("backup contains an unsafe path"), { status: 400 });
        const data = Buffer.from(String(item?.data ?? ""), "base64");
        bytes += data.length;
        if (bytes > MAX_BACKUP_BYTES)
            throw Object.assign(new Error("backup expands beyond the 120 MB local limit"), { status: 413 });
        const destination = resolve(DATA_DIR, path);
        if (!destination.startsWith(resolve(DATA_DIR) + sep))
            throw Object.assign(new Error("backup path escaped the data directory"), { status: 400 });
        mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
        const temp = `${destination}.restore-${process.pid}`;
        writeFileSync(temp, data, { mode: 0o600 });
        renameSync(temp, destination);
        try {
            chmodSync(destination, 0o600);
        }
        catch { }
        restored++;
    }
    return { restored, bytes, restartRequired: true };
}
