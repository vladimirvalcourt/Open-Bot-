import { readFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
const [, , secretPath = "", command = "", ...args] = process.argv;
if (!secretPath || !command)
    process.exit(2);
let secretEnv = {};
try {
    secretEnv = JSON.parse(readFileSync(secretPath, "utf8"));
}
finally {
    try {
        unlinkSync(secretPath);
    }
    catch { }
}
const child = spawn(command, args, {
    env: { ...process.env, ...secretEnv },
    stdio: ["pipe", "pipe", "pipe"],
});
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.once("error", () => process.exit(1));
child.once("exit", (code, signal) => {
    if (signal)
        process.kill(process.pid, signal);
    else
        process.exit(code ?? 1);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
}
