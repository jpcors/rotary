import * as readline from "readline";
import { log, logError } from "../lib/logger.js";

let rl: readline.Interface | null = null;

// Command queue to serialize AGI commands (only one can be in-flight at a time)
let commandQueue: Promise<string> = Promise.resolve("");

function getReadline(): readline.Interface {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, terminal: false });
  }
  return rl;
}

/**
 * Send an AGI command and wait for the response.
 * Commands are serialized — only one runs at a time to prevent response mix-ups.
 * AGI responses look like: "200 result=0" or "200 result=0 endpos=12345"
 */
export function sendCommand(command: string): Promise<string> {
  const prev = commandQueue;
  const current = prev.then(
    () => doSendCommand(command),
    () => doSendCommand(command)
  );
  commandQueue = current.catch(() => ""); // prevent queue from breaking on errors
  return current;
}

function doSendCommand(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    log(`AGI CMD: ${command}`);
    process.stdout.write(command + "\n");

    const reader = getReadline();
    reader.once("line", (line) => {
      log(`AGI RSP: ${line}`);
      if (line.startsWith("200")) {
        resolve(line);
      } else {
        reject(new Error(`AGI command failed: ${line}`));
      }
    });
  });
}

/**
 * Play a WAV file. Path should omit the extension.
 * Returns immediately if the channel hangs up.
 */
export async function streamFile(pathNoExt: string): Promise<void> {
  try {
    await sendCommand(`STREAM FILE "${pathNoExt}" ""`);
  } catch (err) {
    logError(`STREAM FILE error: ${err}`);
  }
}

/**
 * Set a channel variable.
 */
export async function setVariable(name: string, value: string): Promise<void> {
  await sendCommand(`SET VARIABLE ${name} "${value}"`);
}

/**
 * Check if the channel is still up.
 */
export async function channelStatus(): Promise<number> {
  const response = await sendCommand("CHANNEL STATUS");
  const match = response.match(/result=(\d+)/);
  return match ? parseInt(match[1], 10) : -1;
}

export function cleanup(): void {
  if (rl) {
    rl.close();
    rl = null;
  }
}
