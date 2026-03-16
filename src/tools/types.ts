import type { FunctionDeclaration } from "@google/genai";

/**
 * A tool that can be registered with the Gemini Live session.
 * Each tool defines its function declaration (what Gemini sees)
 * and a handler (what runs when Gemini calls it).
 */
export interface Tool {
  declaration: FunctionDeclaration;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}
