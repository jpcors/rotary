import { log } from "../lib/logger.js";
import * as readline from "readline";

export interface AgiEnv {
  [key: string]: string;
}

/**
 * Parse AGI environment variables from stdin.
 * Asterisk sends key: value pairs followed by a blank line.
 */
export function parseAgiEnv(stdin: NodeJS.ReadableStream): Promise<AgiEnv> {
  return new Promise((resolve) => {
    const env: AgiEnv = {};
    const rl = readline.createInterface({ input: stdin, terminal: false });

    rl.on("line", (line) => {
      if (line === "") {
        rl.close();
        resolve(env);
        return;
      }
      const colonIdx = line.indexOf(":");
      if (colonIdx !== -1) {
        const key = line.substring(0, colonIdx).trim();
        const value = line.substring(colonIdx + 1).trim();
        env[key] = value;
      }
    });
  });
}
