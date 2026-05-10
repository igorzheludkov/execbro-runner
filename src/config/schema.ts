import { z } from "zod";

const SlotSchema = z.object({
    id: z.number().int().positive(),
    platform: z.enum(["ios", "android"]),
    deviceId: z.string().min(1),
    androidConsolePort: z.number().int().min(5554).max(5680).optional(),
    metroPort: z.number().int().min(1024).max(65535).optional(),
});

const MetroPortRangeSchema = z
    .object({
        from: z.number().int().min(1024).max(65535),
        to: z.number().int().min(1024).max(65535),
    })
    .refine(r => r.from <= r.to, { message: "metroPortRange.from must be <= metroPortRange.to" });

export const ConfigSchema = z.object({
    slots: z.array(SlotSchema).min(1),
    metroPortRange: MetroPortRangeSchema.default({ from: 8090, to: 8099 }),
    shutdownDeviceAfterTask: z.boolean().default(false),
    stuckTimeoutMinutes: z.number().int().positive().default(30),
    retryProvisioner: z.number().int().min(0).default(2),
    pushOnDone: z.boolean().default(false),
    readinessTimeouts: z
        .object({
            deviceBootSec: z.number().int().positive().default(120),
            metroReadySec: z.number().int().positive().default(60),
            appInstallSec: z.number().int().positive().default(300),
        })
        .default({}),
    notifications: z
        .object({
            macos: z.boolean().default(true),
            slackWebhook: z.string().url().nullable().default(null),
        })
        .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type Slot = z.infer<typeof SlotSchema>;
export type MetroPortRange = z.infer<typeof MetroPortRangeSchema>;
