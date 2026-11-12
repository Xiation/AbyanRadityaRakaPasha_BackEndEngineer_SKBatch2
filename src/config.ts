// Environment configuration, validated once at startup so a bad value fails fast with a clear message
// (instead of PORT=abc silently becoming NaN and failing later inside listen()).
import { z } from "zod";

const configSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DB_PATH: z.string().trim().min(1).default("applicants.db"),
});

export type Config = z.infer<typeof configSchema>;

// Pure function (takes the env as an argument) so it is easy to test.
export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration (${problems})`);
  }
  return result.data;
}
