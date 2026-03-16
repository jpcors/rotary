import { config } from "dotenv";
import { z } from "zod";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", "..", ".env") });

const envSchema = z.object({
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  AI_VOICE: z.string().default("Kore"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  process.stderr.write(
    `Config error: ${parsed.error.issues.map((i) => i.message).join(", ")}\n`
  );
  process.exit(1);
}

export const env = parsed.data;
