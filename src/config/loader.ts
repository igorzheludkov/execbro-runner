import { readFileSync, existsSync } from "node:fs";
import { ConfigSchema, type Config } from "./schema.js";
import { PATHS } from "./paths.js";

export function loadConfigFromPath(path: string): Config {
    if (!existsSync(path)) {
        throw new Error(`Config file not found: ${path}`);
    }
    let raw: string;
    try {
        raw = readFileSync(path, "utf8");
    } catch (e) {
        throw new Error(`Failed to read config: ${(e as Error).message}`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new Error(`Invalid JSON in config: ${(e as Error).message}`);
    }
    const result = ConfigSchema.safeParse(parsed);
    if (!result.success) {
        throw new Error(`Config validation failed: ${result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    }
    const hasLegacyMetroPort = result.data.slots.some(s => s.metroPort !== undefined);
    if (hasLegacyMetroPort) {
        const range = result.data.metroPortRange;
        console.warn(`config: slot.metroPort is deprecated; ports are now dynamically allocated from ${range.from}-${range.to}`);
    }
    return result.data;
}

export function loadConfig(): Config {
    return loadConfigFromPath(PATHS.config);
}
