import { readFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export interface PromptVars {
    worktreePath: string;
    platform: "ios" | "android" | "both";
    deviceId: string;
    metroPort: number;
    bundleId: string;
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

function ensureTemplates(): void {
    const dir = templatesDir();
    mkdirSync(dir, { recursive: true });
    const here = dirname(fileURLToPath(import.meta.url));
    const builtinDir = join(here, "..", "..", "templates");
    for (const name of ["agent-preamble.md", "verification-suffix.md"]) {
        const dst = join(dir, name);
        if (!existsSync(dst)) {
            const src = join(builtinDir, name);
            if (existsSync(src)) copyFileSync(src, dst);
        }
    }
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
    const suffix = readFileSync(join(dir, "verification-suffix.md"), "utf8");
    const vars = input.vars as unknown as Record<string, string | number>;
    return [
        substitute(preamble, vars).trimEnd(),
        "",
        input.userPrompt.trim(),
        "",
        substitute(suffix, vars).trimStart(),
    ].join("\n");
}
