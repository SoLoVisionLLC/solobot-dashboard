#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

function parseArgs(argv) {
    const out = {
        stateDir: path.join(os.homedir(), ".openclaw"),
        agentId: "main",
        noRestart: false
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--state-dir" && argv[i + 1]) {
            out.stateDir = argv[i + 1];
            i += 1;
        } else if (arg === "--agent" && argv[i + 1]) {
            out.agentId = argv[i + 1];
            i += 1;
        } else if (arg === "--no-restart") {
            out.noRestart = true;
        } else if (arg === "-h" || arg === "--help") {
            console.log(`Usage: refresh-openai-codex-oauth [options]

Options:
  --state-dir <path>   OpenClaw state dir (default: ~/.openclaw)
  --agent <id>         Agent id for auth-profiles.json (default: main)
  --no-restart         Do not restart gateway after writing token
`);
            process.exit(0);
        }
    }
    return out;
}

function resolveCodexOAuthModule() {
    const candidates = [
        "/home/linuxbrew/.linuxbrew/lib/node_modules/openclaw/node_modules/@mariozechner/pi-ai/dist/utils/oauth/openai-codex.js",
        "/usr/local/lib/node_modules/openclaw/node_modules/@mariozechner/pi-ai/dist/utils/oauth/openai-codex.js",
        "/opt/homebrew/lib/node_modules/openclaw/node_modules/@mariozechner/pi-ai/dist/utils/oauth/openai-codex.js"
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    throw new Error("Could not find OpenAI Codex OAuth module inside the OpenClaw install.");
}

function decodeJwtPayload(token) {
    try {
        const parts = String(token || "").split(".");
        if (parts.length !== 3) return null;
        return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    } catch {
        return null;
    }
}

function tryOpenBrowser(url) {
    const openCommands = [
        ["xdg-open", [url]],
        ["open", [url]]
    ];
    for (const [cmd, args] of openCommands) {
        const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
        child.on("error", () => { });
        child.unref();
        break;
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const authPath = path.join(args.stateDir, "agents", args.agentId, "agent", "auth-profiles.json");

    if (!fs.existsSync(authPath)) {
        throw new Error(`Auth profile file not found: ${authPath}`);
    }

    const modulePath = resolveCodexOAuthModule();
    const { loginOpenAICodex } = await import(pathToFileURL(modulePath).href);

    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
        console.log(`Using auth file: ${authPath}`);
        console.log("Starting OpenAI Codex OAuth login...");

        const credentials = await loginOpenAICodex({
            onAuth: ({ url, instructions }) => {
                console.log("\nOpen this URL in your browser:");
                console.log(url);
                if (instructions) console.log(instructions);
                tryOpenBrowser(url);
            },
            onPrompt: async ({ message }) => {
                const value = await rl.question(`${message} `);
                return value.trim();
            },
            onProgress: (msg) => {
                if (msg) console.log(`[OAuth] ${msg}`);
            }
        });

        const raw = await fsp.readFile(authPath, "utf8");
        const data = JSON.parse(raw);
        if (!data.profiles || typeof data.profiles !== "object") data.profiles = {};
        if (!data.lastGood || typeof data.lastGood !== "object") data.lastGood = {};
        if (!data.usageStats || typeof data.usageStats !== "object") data.usageStats = {};

        data.profiles["openai-codex:default"] = {
            type: "oauth",
            provider: "openai-codex",
            access: credentials.access,
            refresh: credentials.refresh,
            expires: credentials.expires,
            accountId: credentials.accountId
        };
        data.lastGood["openai-codex"] = "openai-codex:default";

        const stats = data.usageStats["openai-codex:default"] || {};
        delete stats.cooldownUntil;
        delete stats.disabledUntil;
        delete stats.disabledReason;
        stats.errorCount = 0;
        stats.lastUsed = Date.now();
        data.usageStats["openai-codex:default"] = stats;

        await fsp.writeFile(authPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");

        const payload = decodeJwtPayload(credentials.access);
        const scopes = Array.isArray(payload?.scp) ? payload.scp : [];
        console.log("\nSaved refreshed OpenAI Codex OAuth credentials.");
        console.log(`Token scopes: ${scopes.join(", ") || "(none found)"}`);

        if (!scopes.includes("api.responses.write")) {
            console.warn("Warning: token still missing api.responses.write. Codex model calls may still fail.");
        }

        if (!args.noRestart) {
            console.log("\nRestarting gateway...");
            spawnSync("openclaw", ["gateway", "restart"], { stdio: "inherit" });
        }

        console.log("\nDone. Validate with:");
        console.log("openclaw models status --json --probe --probe-provider openai-codex");
    } finally {
        rl.close();
    }
}

main().catch((err) => {
    console.error(`Error: ${err?.message || err}`);
    process.exit(1);
});
