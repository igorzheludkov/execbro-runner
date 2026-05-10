import { readFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export interface DeviceVar {
    platform: "ios" | "android";
    deviceId: string;
    bundleId: string;
}

export interface PromptVars {
    worktreePath: string;
    metroPort: number;
    devices: DeviceVar[];
}

export interface RenderPromptInput {
    userPrompt: string;
    vars: PromptVars;
}

function execbroRoot(): string {
    return process.env.EXECBRO_HOME ?? join(homedir(), ".execbro");
}

function templatesDir(): string {
    return join(execbroRoot(), "templates");
}

const TEMPLATE_FILES = [
    "agent-preamble.md",
    "verification-suffix-single.md",
    "verification-suffix-multi.md",
    "headless-system-prompt.md",
];

/**
 * Find this package's `templates/` directory by walking up from the bin
 * script (in production: an installed CLI; under jest: the jest runner) or
 * from cwd as a last-resort fallback. Returns null when the package root
 * cannot be located — callers must tolerate the absence (tests pre-write
 * templates to EXECBRO_HOME, so the copy step is a no-op).
 */
function findBuiltinTemplatesDir(): string | null {
    const candidates = [process.argv[1], process.cwd()].filter(Boolean) as string[];
    for (const start of candidates) {
        let dir = existsSync(start) ? dirname(start) : start;
        while (dir && dir !== "/" && dir !== ".") {
            const pkgPath = join(dir, "package.json");
            if (existsSync(pkgPath)) {
                try {
                    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
                    if (pkg?.name === "execbro-runner") {
                        return join(dir, "templates");
                    }
                } catch { /* skip unparseable */ }
            }
            const parent = dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
    }
    return null;
}

function ensureTemplates(): void {
    const dir = templatesDir();
    mkdirSync(dir, { recursive: true });
    const builtinDir = findBuiltinTemplatesDir();
    if (!builtinDir) return;
    for (const name of TEMPLATE_FILES) {
        const dst = join(dir, name);
        if (!existsSync(dst)) {
            const src = join(builtinDir, name);
            if (existsSync(src)) copyFileSync(src, dst);
        }
    }
}

function renderDeviceList(devices: DeviceVar[]): string {
    return devices
        .map(d => `- ${d.platform} on ${d.deviceId} (bundle ${d.bundleId})`)
        .join("\n");
}

function buildSubstitutionMap(vars: PromptVars): Record<string, string | number> {
    const map: Record<string, string | number> = {
        worktreePath: vars.worktreePath,
        metroPort: vars.metroPort,
        deviceCount: vars.devices.length,
        devices: renderDeviceList(vars.devices),
        platformList: vars.devices.map(d => d.platform).join(", "),
    };
    if (vars.devices.length === 1) {
        const only = vars.devices[0];
        map.platform = only.platform;
        map.deviceId = only.deviceId;
        map.bundleId = only.bundleId;
    }
    return map;
}

function substitute(template: string, vars: Record<string, string | number>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return key in vars ? String(vars[key]) : match;
    });
}

export function renderPrompt(input: RenderPromptInput): string {
    ensureTemplates();
    const dir = templatesDir();
    const preamble = readFileSync(join(dir, "agent-preamble.md"), "utf8");
    const suffixFile = input.vars.devices.length === 1
        ? "verification-suffix-single.md"
        : "verification-suffix-multi.md";
    const suffix = readFileSync(join(dir, suffixFile), "utf8");
    const map = buildSubstitutionMap(input.vars);
    return [
        substitute(preamble, map).trimEnd(),
        "",
        input.userPrompt.trim(),
        "",
        substitute(suffix, map).trimStart(),
    ].join("\n");
}
