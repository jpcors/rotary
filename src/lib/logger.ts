// Log to stderr so we don't interfere with AGI stdin/stdout protocol
export function log(...args: unknown[]): void {
  process.stderr.write(`[rotary] ${args.map(String).join(" ")}\n`);
}

export function logError(...args: unknown[]): void {
  process.stderr.write(`[rotary ERROR] ${args.map(String).join(" ")}\n`);
}
