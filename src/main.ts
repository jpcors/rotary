#!/usr/bin/env node

import { parseAgiEnv } from "./agi/parser.js";
import { streamFile, channelStatus, cleanup as cleanupAgi } from "./agi/commands.js";
import { EagiAudioReader } from "./agi/eagi-audio.js";
import { GeminiLiveSession } from "./gemini/live-session.js";
import { StreamingPlayer } from "./audio/streaming-player.js";
import { upsample8to16 } from "./audio/resampler.js";
import { log, logError } from "./lib/logger.js";
import { loadAgentConfig, buildGreetingPrompt } from "./lib/agent.js";
import { loadTools } from "./tools/registry.js";

// Import config to trigger env validation
import "./lib/config.js";

async function main(): Promise<void> {
  log("Rotary AI Assistant starting");

  // Step 1: Parse AGI environment
  const agiEnv = await parseAgiEnv(process.stdin);
  log(`Channel: ${agiEnv["agi_channel"]}, Caller: ${agiEnv["agi_callerid"]}`);

  // Step 2: Set up EAGI audio reader
  const audioReader = new EagiAudioReader();

  // Step 3: Set up streaming player
  const player = new StreamingPlayer(streamFile, {
    tmpDir: "/tmp",
    onPlaybackStart: () => {
      log("Streaming playback started");
      audioReader.pause();
    },
    onPlaybackEnd: () => {
      log("Streaming playback finished, listening resumed");
      audioReader.resume();
    },
  });

  // Step 4: Load agent config and tools, connect to Gemini
  const agentConfig = loadAgentConfig();
  const tools = loadTools();
  const gemini = new GeminiLiveSession(
    // onAudio: push chunks to streaming player (plays ASAP)
    (pcm24kHz: Buffer) => {
      player.pushChunk(pcm24kHz);
    },
    // onTurnComplete: signal end of turn
    () => {
      log("Gemini turn complete");
      player.turnComplete();
    },
    tools,
    agentConfig
  );

  await gemini.connect();

  // Step 5: Send initial greeting prompt so Gemini speaks first
  gemini.sendText(buildGreetingPrompt(agentConfig));

  // Step 6: Start reading audio from fd3 and forwarding to Gemini
  audioReader.start((chunk: Buffer) => {
    if (player.isPlaying) return;

    // Upsample 8kHz → 16kHz for Gemini
    const pcm16kHz = upsample8to16(chunk);
    gemini.sendAudio(pcm16kHz);
  });

  // Step 7: Monitor for hangup
  const hangupCheck = setInterval(async () => {
    try {
      const status = await channelStatus();
      // 6 = Up, anything else means the channel is gone
      if (status !== 6) {
        log(`Channel status ${status}, shutting down`);
        shutdown();
      }
    } catch {
      // Command failed, channel is probably gone
      log("Channel gone, shutting down");
      shutdown();
    }
  }, 5000);

  function shutdown(): void {
    clearInterval(hangupCheck);
    audioReader.stop();
    gemini.close();
    player.cleanup();
    cleanupAgi();

    log("Shutdown complete");
    process.exit(0);
  }

  // Handle process signals
  process.on("SIGHUP", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGPIPE", shutdown);
}

main().catch((err) => {
  logError(`Fatal: ${err}`);
  process.exit(1);
});
