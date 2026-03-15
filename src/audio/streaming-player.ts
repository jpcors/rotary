import * as fs from "fs";
import * as path from "path";
import { downsample24to8 } from "./resampler.js";
import { createWav } from "./wav.js";

export interface PlaySegmentFn {
  (wavPathNoExt: string): Promise<void>;
}

export interface StreamingPlayerOptions {
  tmpDir?: string;
  onPlaybackStart?: () => void;
  onPlaybackEnd?: () => void;
}

export class StreamingPlayer {
  private playSegment: PlaySegmentFn;
  private tmpDir: string;
  private onPlaybackStart?: () => void;
  private onPlaybackEnd?: () => void;

  private pendingChunks: Buffer[] = [];
  private segmentCounter = 0;
  private playing = false;
  private turnReceived = false;
  private drainResolve: (() => void) | null = null;
  private drainPromise: Promise<void> | null = null;
  private segmentFiles: string[] = [];

  constructor(playSegment: PlaySegmentFn, opts?: StreamingPlayerOptions) {
    this.playSegment = playSegment;
    this.tmpDir = opts?.tmpDir ?? "/tmp";
    this.onPlaybackStart = opts?.onPlaybackStart;
    this.onPlaybackEnd = opts?.onPlaybackEnd;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  pushChunk(pcm24kHz: Buffer): void {
    this.pendingChunks.push(pcm24kHz);

    if (!this.playing) {
      this.playing = true;
      this.onPlaybackStart?.();
      this.drainPromise = new Promise((resolve) => {
        this.drainResolve = resolve;
      });
      this.flushLoop().catch(() => {
        // Errors handled inside flushLoop's finally block
      });
    }
  }

  turnComplete(): void {
    this.turnReceived = true;

    // If nothing is playing and nothing is pending, resolve immediately
    if (!this.playing && this.pendingChunks.length === 0) {
      this.turnReceived = false;
      return;
    }
  }

  waitUntilDrained(): Promise<void> {
    if (!this.drainPromise) return Promise.resolve();
    return this.drainPromise;
  }

  cleanup(): void {
    for (const f of this.segmentFiles) {
      try { fs.unlinkSync(f); } catch {}
    }
    this.segmentFiles = [];
  }

  private async flushLoop(): Promise<void> {
    try {
      while (true) {
        if (this.pendingChunks.length > 0) {
          // Grab all available chunks
          const chunks = this.pendingChunks.splice(0);
          const combined = Buffer.concat(chunks);

          // Downsample and write WAV
          const pcm8kHz = downsample24to8(combined);
          const segPath = path.join(this.tmpDir, `segment_${this.segmentCounter++}`);
          const wavFile = `${segPath}.wav`;
          const wavData = createWav(pcm8kHz, 8000);
          fs.writeFileSync(wavFile, wavData);
          this.segmentFiles.push(wavFile);

          // Play segment (blocks until playback finishes)
          await this.playSegment(segPath);

          // Clean up immediately
          try { fs.unlinkSync(wavFile); } catch {}
          this.segmentFiles = this.segmentFiles.filter((f) => f !== wavFile);

          continue; // Check for more
        }

        if (this.turnReceived) {
          break; // All done
        }

        // Wait for more chunks or turnComplete
        await new Promise((r) => setTimeout(r, 30));
      }
    } finally {
      this.playing = false;
      this.turnReceived = false;
      this.pendingChunks = [];
      this.onPlaybackEnd?.();
      this.drainResolve?.();
      this.drainResolve = null;
      this.drainPromise = null;
    }
  }
}
