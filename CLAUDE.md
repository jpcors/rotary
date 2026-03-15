# Rotary Phone AI Assistant

## Quick Reference

- **Build**: `npm run build` (runs `tsc`)
- **Test**: `npm test` (runs `vitest`)
- **Deploy**: `npm run deploy` (builds, SCPs to Pi, restarts Asterisk)
- **Pi deploy path**: `/usr/share/asterisk/agi-bin/rotary/`
- **Asterisk configs**: `/etc/asterisk/` on Pi

## Architecture

Rotary Phone → Grandstream HT801 (SIP ATA) → Raspberry Pi (Asterisk) → EAGI fd3 → Node.js → Gemini Live API WebSocket.

Audio: fd3 delivers 8kHz slin → upsample to 16kHz → Gemini. Gemini responds 24kHz PCM → downsample to 8kHz → WAV → STREAM FILE (streamed in segments as chunks arrive).

## Code Conventions

- TypeScript with ESM (`"type": "module"` in package.json, `.js` extensions in imports)
- All logging goes to **stderr** (stdout is reserved for AGI protocol commands)
- No native audio dependencies — resampling is pure TS linear interpolation
- Config validated with zod at startup; env loaded via dotenv with absolute path resolution
- Tests use vitest; test files excluded from tsc build via tsconfig

## Key Technical Details

- **EAGI fd3**: Signed linear 16-bit, 8000 Hz, mono, little-endian. Reads in 100ms chunks (1600 bytes).
- **Gemini model**: `gemini-2.5-flash-native-audio-preview-12-2025`
- **Gemini input**: `audio/pcm;rate=16000` (base64 encoded)
- **Gemini output**: 24kHz PCM audio
- **Gemini VAD**: Uses default automatic activity detection. Custom `realtimeInputConfig` breaks VAD after `sendClientContent` — do not override.
- **Streaming playback**: `StreamingPlayer` class plays audio segments as they arrive from Gemini. First audio plays immediately; subsequent chunks accumulate during playback and play when current segment finishes.
- **AGI command queue**: Commands are serialized to prevent response mix-ups between concurrent STREAM FILE and CHANNEL STATUS calls.
- **During playback**: fd3 reading is paused to prevent feedback loop
- **Wrapper script on Pi**: `run-eagi.sh` redirects stderr to `/tmp/eagi-stderr.log`

## Deployment

The deploy script (`scripts/deploy.sh`) handles everything:
1. `npm run build`
2. SCP dist + package.json + package-lock.json + .env to Pi
3. SCP asterisk/*.conf to /etc/asterisk/ (backs up originals)
4. `npm install --omit=dev` on Pi
5. Secure `.env` permissions (chmod 600)
6. `systemctl restart asterisk`

## Common Issues

- **HT801 not registering after Asterisk restart**: Give it 30-60 seconds, or reboot HT801
- **EAGI script crashes immediately**: Check that `.env` file exists on Pi at the deploy path
- **No audio from caller**: Verify HT801 Silence Suppression is OFF, Echo Cancellation is OFF
- **Gemini doesn't respond to speech**: Do NOT set custom `realtimeInputConfig` — it breaks VAD after the initial text greeting. Use Gemini's default VAD.
- **Gemini session closes immediately**: Check model name is correct and API key has Live API access
- **dotenv can't find .env**: Config uses `import.meta.url` for absolute path resolution — this is intentional since EAGI runs with Asterisk's cwd, not the script directory
- **AGI commands getting wrong responses**: The command queue in `commands.ts` serializes all AGI commands. If you see mixed-up responses, ensure all AGI calls go through `sendCommand()`.
