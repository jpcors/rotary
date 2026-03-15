import * as fs from "fs";
import { log, logError } from "../lib/logger.js";

const EAGI_FD = 3; // Asterisk EAGI audio file descriptor
const CHUNK_MS = 100; // How often to emit chunks
const SAMPLE_RATE = 8000;
const BYTES_PER_SAMPLE = 2; // 16-bit signed linear
const CHUNK_SIZE = (SAMPLE_RATE * BYTES_PER_SAMPLE * CHUNK_MS) / 1000; // 1600 bytes per 100ms

export type AudioChunkCallback = (chunk: Buffer) => void;

/**
 * Read real-time audio from EAGI fd3.
 * Asterisk delivers signed linear 16-bit, 8000 Hz, mono, little-endian.
 */
export class EagiAudioReader {
  private stream: fs.ReadStream | null = null;
  private paused = false;

  start(onChunk: AudioChunkCallback): void {
    try {
      this.stream = fs.createReadStream("", {
        fd: EAGI_FD,
        autoClose: false,
        highWaterMark: CHUNK_SIZE,
      });

      let buffer = Buffer.alloc(0);

      this.stream.on("data", (data: Buffer | string) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (this.paused) return;

        buffer = Buffer.concat([buffer, buf]);

        while (buffer.length >= CHUNK_SIZE) {
          const chunk = buffer.subarray(0, CHUNK_SIZE);
          buffer = buffer.subarray(CHUNK_SIZE);
          onChunk(chunk);
        }
      });

      this.stream.on("error", (err) => {
        logError(`fd3 read error: ${err.message}`);
      });

      this.stream.on("end", () => {
        log("fd3 stream ended (channel hangup)");
      });

      log("EAGI audio reader started");
    } catch (err) {
      logError(`Failed to open fd3: ${err}`);
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  stop(): void {
    if (this.stream) {
      this.stream.destroy();
      this.stream = null;
    }
  }
}
