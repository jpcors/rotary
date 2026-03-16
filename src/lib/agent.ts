import { z } from "zod";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { log } from "./logger.js";

const agentSchema = z.object({
  name: z.string(),
  personality: z.string(),
  context: z.string().optional(),
  greeting: z.string().optional(),
});

export type AgentConfig = z.infer<typeof agentSchema>;

const DEFAULT_AGENT: AgentConfig = {
  name: "Rotary",
  personality: "You are a friendly AI assistant. Keep responses concise and conversational.",
};

export function loadAgentConfig(): AgentConfig {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const agentPath = join(__dirname, "..", "..", "agent.json");

  try {
    const raw = readFileSync(agentPath, "utf-8");
    const config = agentSchema.parse(JSON.parse(raw));
    log(`Agent loaded: ${config.name}`);
    return config;
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      log("No agent.json found, using default agent config");
      return DEFAULT_AGENT;
    }
    throw err;
  }
}

export function buildSystemInstruction(agent: AgentConfig): string {
  const parts = [
    `Your name is ${agent.name}.`,
    agent.personality,
    "You are answering a call on a rotary telephone. " +
      "The caller is using a vintage rotary phone, so audio quality may be limited — " +
      "there will be background noise and static on the line. " +
      "Do not interpret line noise as the caller trying to speak. Be to the point.",
  ];

  if (agent.context) {
    parts.push(agent.context);
  }

  return parts.join("\n\n");
}

export function buildGreetingPrompt(agent: AgentConfig): string {
  if (agent.greeting) {
    return agent.greeting;
  }
  return "The caller just picked up the phone. Greet them warmly and briefly.";
}
