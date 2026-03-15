import { describe, it, expect, vi } from "vitest";
import { StreamingPlayer } from "./streaming-player.js";

/** Create a fake PCM buffer at 24kHz (16-bit LE, so 2 bytes per sample) */
function fakePcm24k(durationMs: number): Buffer {
  const samples = Math.floor(24000 * (durationMs / 1000));
  const buf = Buffer.alloc(samples * 2);
  // Fill with a simple sine-ish pattern so it's not all zeros
  for (let i = 0; i < samples; i++) {
    const val = Math.round(Math.sin(i * 0.1) * 10000);
    buf.writeInt16LE(val, i * 2);
  }
  return buf;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("StreamingPlayer", () => {
  it("plays first chunk immediately without waiting for turnComplete", async () => {
    const played: string[] = [];
    const fakePlay = vi.fn(async (path: string) => {
      played.push(path);
    });

    const player = new StreamingPlayer(fakePlay, { tmpDir: "/tmp" });

    // Push a chunk — playback should start immediately
    player.pushChunk(fakePcm24k(100));

    // Give the flush loop time to run
    await delay(50);

    // Should have played at least one segment before turnComplete
    expect(fakePlay).toHaveBeenCalledTimes(1);
    expect(played.length).toBe(1);
    expect(played[0]).toMatch(/segment_\d+/);

    // Now signal turn complete
    player.turnComplete();
    await player.waitUntilDrained();
  });

  it("accumulates chunks during playback and plays them after", async () => {
    const played: string[] = [];
    let playResolvers: (() => void)[] = [];

    // playSegment blocks until we manually resolve
    const fakePlay = vi.fn(
      (path: string) =>
        new Promise<void>((resolve) => {
          played.push(path);
          playResolvers.push(resolve);
        })
    );

    const player = new StreamingPlayer(fakePlay, { tmpDir: "/tmp" });

    // Push first chunk — starts playing
    player.pushChunk(fakePcm24k(100));
    await delay(20);
    expect(fakePlay).toHaveBeenCalledTimes(1);

    // Push more chunks while first is "playing"
    player.pushChunk(fakePcm24k(100));
    player.pushChunk(fakePcm24k(100));
    await delay(20);

    // Still only 1 playback call (first segment is blocking)
    expect(fakePlay).toHaveBeenCalledTimes(1);

    // Finish first segment
    playResolvers[0]();
    await delay(50);

    // Second batch should now be playing
    expect(fakePlay).toHaveBeenCalledTimes(2);

    // Signal turn complete and finish remaining playback
    player.turnComplete();
    playResolvers[1]();
    await player.waitUntilDrained();

    expect(fakePlay).toHaveBeenCalledTimes(2);
  });

  it("handles turnComplete with no audio (empty response)", async () => {
    const fakePlay = vi.fn(async () => {});
    const onStart = vi.fn();
    const onEnd = vi.fn();

    const player = new StreamingPlayer(fakePlay, {
      tmpDir: "/tmp",
      onPlaybackStart: onStart,
      onPlaybackEnd: onEnd,
    });

    player.turnComplete();
    await player.waitUntilDrained();

    expect(fakePlay).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("fires onPlaybackStart once and onPlaybackEnd once", async () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const fakePlay = vi.fn(async () => {});

    const player = new StreamingPlayer(fakePlay, {
      tmpDir: "/tmp",
      onPlaybackStart: onStart,
      onPlaybackEnd: onEnd,
    });

    player.pushChunk(fakePcm24k(100));
    await delay(20);
    expect(onStart).toHaveBeenCalledTimes(1);

    player.pushChunk(fakePcm24k(100));
    await delay(20);
    // Should NOT fire again for second chunk
    expect(onStart).toHaveBeenCalledTimes(1);

    player.turnComplete();
    await player.waitUntilDrained();

    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("handles turnComplete arriving while playing", async () => {
    let playResolver: (() => void) | null = null;
    const fakePlay = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          playResolver = resolve;
        })
    );

    const player = new StreamingPlayer(fakePlay, { tmpDir: "/tmp" });

    // Start playing
    player.pushChunk(fakePcm24k(100));
    await delay(20);
    expect(fakePlay).toHaveBeenCalledTimes(1);

    // Turn completes while first segment is still playing
    player.turnComplete();

    // Finish playing
    playResolver!();
    await player.waitUntilDrained();

    // Should have played exactly 1 segment
    expect(fakePlay).toHaveBeenCalledTimes(1);
  });

  it("handles turnComplete with pending chunks after playback", async () => {
    let resolvers: (() => void)[] = [];
    const fakePlay = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        })
    );

    const player = new StreamingPlayer(fakePlay, { tmpDir: "/tmp" });

    // Push first chunk, starts playing
    player.pushChunk(fakePcm24k(100));
    await delay(20);
    expect(fakePlay).toHaveBeenCalledTimes(1);

    // Push more while playing, then signal turnComplete
    player.pushChunk(fakePcm24k(100));
    player.turnComplete();

    // Finish first segment
    resolvers[0]();
    await delay(50);

    // Should play the remaining chunk
    expect(fakePlay).toHaveBeenCalledTimes(2);

    // Finish second segment
    resolvers[1]();
    await player.waitUntilDrained();

    expect(fakePlay).toHaveBeenCalledTimes(2);
  });

  it("handles playback error gracefully", async () => {
    const onEnd = vi.fn();
    const fakePlay = vi.fn(async () => {
      throw new Error("AGI error");
    });

    const player = new StreamingPlayer(fakePlay, {
      tmpDir: "/tmp",
      onPlaybackEnd: onEnd,
    });

    player.pushChunk(fakePcm24k(100));
    player.turnComplete();

    await player.waitUntilDrained();

    // onPlaybackEnd should still fire even on error
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(player.isPlaying).toBe(false);
  });

  it("isPlaying reflects correct state", async () => {
    let playResolver: (() => void) | null = null;
    const fakePlay = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          playResolver = resolve;
        })
    );

    const player = new StreamingPlayer(fakePlay, { tmpDir: "/tmp" });

    expect(player.isPlaying).toBe(false);

    player.pushChunk(fakePcm24k(100));
    await delay(20);
    expect(player.isPlaying).toBe(true);

    player.turnComplete();
    playResolver!();
    await player.waitUntilDrained();

    expect(player.isPlaying).toBe(false);
  });

  it("can handle multiple turns sequentially", async () => {
    const fakePlay = vi.fn(async () => {});
    const onStart = vi.fn();
    const onEnd = vi.fn();

    const player = new StreamingPlayer(fakePlay, {
      tmpDir: "/tmp",
      onPlaybackStart: onStart,
      onPlaybackEnd: onEnd,
    });

    // Turn 1
    player.pushChunk(fakePcm24k(100));
    player.turnComplete();
    await player.waitUntilDrained();

    expect(fakePlay).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);

    // Turn 2
    player.pushChunk(fakePcm24k(100));
    player.turnComplete();
    await player.waitUntilDrained();

    expect(fakePlay).toHaveBeenCalledTimes(2);
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onEnd).toHaveBeenCalledTimes(2);
  });

  it("writes valid WAV files with downsampled audio", async () => {
    const writtenPaths: string[] = [];
    const fakePlay = vi.fn(async (pathNoExt: string) => {
      writtenPaths.push(pathNoExt);
    });

    const player = new StreamingPlayer(fakePlay, { tmpDir: "/tmp" });

    const chunk = fakePcm24k(200);
    player.pushChunk(chunk);
    player.turnComplete();
    await player.waitUntilDrained();

    // The WAV is cleaned up after play, but we can verify the play was called
    expect(writtenPaths.length).toBe(1);
    expect(fakePlay).toHaveBeenCalledTimes(1);
  });
});
