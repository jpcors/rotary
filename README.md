# Rotary

An AI voice assistant that runs on a vintage rotary telephone. Pick up the phone and have a real-time conversation with Google's Gemini — no touchscreen required.

```
┌─────────────┐     RJ11      ┌──────────────┐    Ethernet    ┌──────────┐
│ Rotary Phone │──────────────▶│ Grandstream  │───────────────▶│  Router  │
│              │  2-wire       │   HT801      │  SIP/RTP       │          │
│  (rewired    │  analog       │  (ATA)       │  over LAN      │          │
│   for RJ11)  │  audio        │              │                │          │
└─────────────┘               └──────────────┘                └────┬─────┘
                                                                   │ WiFi
                                                                   │
                                                              ┌────▼─────────────┐
                                                              │  Raspberry Pi     │
                                                              │  Zero 2 W         │
                                                              │                   │
                                                              │  ┌─────────────┐  │
                                                              │  │  Asterisk    │  │
                                                              │  │  (PBX)      │  │
                                                              │  └──────┬──────┘  │
                                                              │         │ EAGI    │
                                                              │         │ fd3     │
                                                              │  ┌──────▼──────┐  │
                                                              │  │  Node.js    │  │
                                                              │  │  EAGI app   │  │
                                                              │  └──────┬──────┘  │
                                                              └─────────┼─────────┘
                                                                        │ WebSocket
                                                                        │
                                                              ┌─────────▼─────────┐
                                                              │  Gemini Live API  │
                                                              │  (Google Cloud)   │
                                                              └───────────────────┘
```

## How It Works

### The Physical Layer

A vintage rotary phone's original wiring is two copper conductors carrying analog audio. Rotary phones predate modular jacks — the handset cable was hardwired. To make it work with modern equipment, the phone is rewired to terminate in an **RJ11 connector**, which plugs into a **Grandstream HT801** analog telephone adapter (ATA).

### The ATA: Analog to Digital Bridge

The **Grandstream HT801** is a single-port FXS (Foreign Exchange Subscriber) gateway. It does the heavy lifting of bridging the analog and digital worlds:

- **FXS port** provides dial tone, ring voltage, and loop current to the rotary phone — the phone thinks it's connected to a traditional phone line
- **Codec conversion**: Converts analog audio to G.711 μ-law (PCMU) digital audio at 8kHz
- **SIP registration**: Registers as a SIP endpoint with Asterisk over the LAN
- **RTP streaming**: Sends/receives audio as RTP packets over UDP
- **Pulse dial detection**: Interprets the rotary dial's make/break pulses as DTMF digits (the HT801 has a specific setting for this — most ATAs only support tone dialing)

The HT801 connects via ethernet to the router on the same LAN as the Pi.

### The PBX: Asterisk

A **Raspberry Pi Zero 2 W** runs **Asterisk**, an open-source PBX (Private Branch Exchange). Asterisk handles:

- **SIP endpoint management** via PJSIP — authenticates the HT801 and manages the call session
- **Dialplan routing** — when the phone goes off-hook or a number is dialed, routes the call to the EAGI application
- **Audio bridging** — converts between codecs and provides the raw audio stream

The key Asterisk feature here is **EAGI** (Enhanced AGI). Standard AGI only provides stdin/stdout for command exchange. EAGI additionally exposes **file descriptor 3 (fd3)** — a real-time stream of signed linear 16-bit, 8000 Hz, mono, little-endian audio from the channel. This is what enables live audio streaming to the AI.

### The Application: Node.js EAGI Script

When a call comes in, Asterisk launches a Node.js TypeScript application via EAGI. The app:

1. **Parses the AGI environment** from stdin (channel info, caller ID, etc.)
2. **Opens a Gemini Live API WebSocket** connection
3. **Sends a greeting prompt** via text so Gemini speaks first ("The caller just picked up the phone. Greet them warmly.")
4. **Streams audio bidirectionally**:
   - **Inbound**: Reads 8kHz PCM from fd3 → upsamples to 16kHz via linear interpolation → sends to Gemini as base64-encoded PCM chunks
   - **Outbound**: Receives 24kHz PCM from Gemini → downsamples to 8kHz → writes WAV file → plays via AGI `STREAM FILE` command
5. **Streaming playback**: Audio plays as segments arrive from Gemini rather than waiting for the complete response, minimizing perceived latency
6. **Monitors for hangup** via periodic `CHANNEL STATUS` polling

### The AI: Gemini Live API

The **Gemini Live API** provides a persistent WebSocket connection for real-time bidirectional audio streaming. The model handles:

- **Voice Activity Detection (VAD)** — automatically detects when the caller starts and stops speaking, managing turn-taking without any custom logic
- **Speech-to-speech** — processes audio input and generates audio output natively (no separate STT → LLM → TTS pipeline)
- **Streaming output** — sends audio chunks as they're generated, which our streaming player picks up immediately

### Audio Pipeline Detail

```
INBOUND (Caller → AI):
  Phone mic → HT801 (μ-law → slin 8kHz) → Asterisk → fd3 → upsample 8→16kHz → Gemini WebSocket

OUTBOUND (AI → Caller):
  Gemini (24kHz PCM chunks) → downsample 24→8kHz → WAV → STREAM FILE → Asterisk → HT801 → Phone speaker
```

All resampling is pure TypeScript using linear interpolation — no native audio dependencies (sox, ffmpeg, etc.).

## Project Structure

```
├── asterisk/                    # Asterisk config files (deployed to /etc/asterisk/)
│   ├── pjsip.conf               # SIP endpoint configuration
│   ├── extensions.conf           # Dialplan routing
│   └── modules.conf              # Module loading
├── scripts/
│   └── deploy.sh                 # Build + deploy to Pi
├── src/
│   ├── main.ts                   # Entry point: EAGI bootstrap + conversation loop
│   ├── agi/
│   │   ├── parser.ts             # Parse AGI env vars from stdin
│   │   ├── commands.ts           # AGI command queue (STREAM FILE, CHANNEL STATUS)
│   │   └── eagi-audio.ts         # Read real-time audio from fd3
│   ├── gemini/
│   │   └── live-session.ts       # Gemini Live API WebSocket session
│   ├── audio/
│   │   ├── streaming-player.ts   # Segmented streaming playback
│   │   ├── resampler.ts          # Pure TS linear interpolation (8kHz↔16kHz↔24kHz)
│   │   └── wav.ts                # WAV header creation
│   └── lib/
│       ├── config.ts             # Env validation (zod + dotenv)
│       └── logger.ts             # stderr logging (stdout reserved for AGI)
├── .env.example
├── package.json
└── tsconfig.json
```

## Prerequisites

- **Rotary phone** rewired with an RJ11 connector
- **Grandstream HT801** (or similar FXS ATA with pulse dial support)
- **Raspberry Pi** running Asterisk (tested on Pi Zero 2 W with Raspberry Pi OS)
- **Gemini API key** with access to the Live API
- All devices on the same LAN

## Setup

### 1. Environment

```bash
git clone https://github.com/jpcors/rotary.git
cd rotary
npm install
cp .env.example .env
```

Edit `.env`:
```
GEMINI_API_KEY=your-gemini-api-key
PI_HOST=pi@pi.local
AI_VOICE=Kore
```

### 2. Grandstream HT801

Access the HT801 web UI at its IP address.

> **Security**: Change the default admin password immediately. The factory default is `admin`.

**FXS Port Settings:**
| Setting | Value | Why |
|---|---|---|
| SIP Server | Your Pi's IP | Where to register |
| SIP User ID / Auth ID | Match `pjsip.conf` | SIP authentication |
| Auth Password | Match `pjsip.conf` | SIP authentication |
| Preferred Vocoder | PCMU | G.711 μ-law (telephony standard) |
| Silence Suppression | **No** | Will eat voice input if enabled |
| Enable Pulse Dialing | **Yes** | Required for rotary dial |

**Audio Settings (critical):**
| Setting | Value | Why |
|---|---|---|
| Echo Cancellation | **Disable** | Rotary phone impedance confuses the algorithm, suppressing real audio |
| Echo Suppression | **Disable** | Same reason |
| Noise Suppression | **Disable** | Aggressive filtering removes speech on noisy analog lines |
| Comfort Noise | **Disable** | Artificial noise interferes with VAD |
| TX Gain | 0 dB | Increase to +3/+6 if phone mic is too quiet |

### 3. Asterisk Configuration

Edit `asterisk/pjsip.conf`:
- Set the SIP password (change `CHANGEME`)
- Set the `match` IP to your HT801's address or subnet

The configs are deployed automatically by the deploy script, but you can also copy them manually:
```bash
sudo cp asterisk/*.conf /etc/asterisk/
sudo systemctl restart asterisk
```

### 4. Deploy

```bash
npm run deploy
```

This builds TypeScript, copies everything to the Pi, installs production dependencies, and restarts Asterisk.

### 5. Verify

```bash
ssh pi@pi.local 'sudo asterisk -rx "pjsip show contacts"'
# Should show your endpoint as "Avail"
```

Pick up the phone. Gemini greets you. Talk.

## Dialplan

| Extension | Action |
|---|---|
| `s` (off-hook) | AI assistant |
| `0` | AI assistant |
| Any number | AI assistant |
| `999` | Echo test (hear your own voice) |
| `888` | Record test (record 5s, play back) |

## Security Considerations

This project involves telephony infrastructure. If you deploy it:

- **Change all default passwords** — HT801 admin, SIP credentials in `pjsip.conf`, Pi user password
- **Firewall SIP/RTP ports** — Only allow traffic from your ATA's IP to ports 5060 (SIP) and 10000-20000 (RTP)
- **Disable SSH password auth** — Use key-based SSH only on the Pi
- **Keep `.env` secure** — Contains your Gemini API key. The deploy script sets `chmod 600` on the Pi
- **Restrict Asterisk** — The bundled config only accepts connections from the local subnet. Tighten the `match` in `pjsip.conf` to your ATA's specific IP for production use
- **Disable test extensions** — Remove or comment out extensions `999` and `888` in `extensions.conf` when not debugging

## Debugging

```bash
# EAGI application log (most useful)
ssh pi@pi.local 'cat /tmp/eagi-stderr.log'

# Asterisk verbose log
ssh pi@pi.local 'sudo tail -50 /var/log/asterisk/messages.log'

# Check SIP registration
ssh pi@pi.local 'sudo asterisk -rx "pjsip show contacts"'

# Test without physical phone (originate a local channel)
ssh pi@pi.local 'sudo asterisk -rx "channel originate Local/0@rotary-phone application Wait 60"'
```

## Dependencies

| Package | Purpose |
|---|---|
| `@google/genai` | Gemini Live API (WebSocket streaming) |
| `dotenv` | Environment configuration |
| `zod` | Runtime config validation |

No audio processing binaries required. All resampling is pure TypeScript.

## License

MIT
