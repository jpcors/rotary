import type { Tool } from "./types.js";
import { createSmsTool } from "./sms/index.js";
import { log } from "../lib/logger.js";

/**
 * Load all enabled tools. Tools that are missing required config
 * will return null and be skipped.
 */
export function loadTools(): Tool[] {
  const tools: Tool[] = [];

  // Add new tools here as they're created
  const candidates = [
    createSmsTool(),
  ];

  for (const tool of candidates) {
    if (tool) {
      tools.push(tool);
      log(`Tool enabled: ${tool.declaration.name}`);
    }
  }

  log(`${tools.length} tool(s) loaded`);
  return tools;
}
