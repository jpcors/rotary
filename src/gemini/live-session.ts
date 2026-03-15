import { GoogleGenAI, Modality, type Session } from "@google/genai";
import { env } from "../lib/config.js";
import { log, logError } from "../lib/logger.js";

export type AudioResponseCallback = (pcm24kHz: Buffer) => void;
export type TurnCompleteCallback = () => void;

export class GeminiLiveSession {
  private ai: GoogleGenAI;
  private session: Session | null = null;
  private onAudio: AudioResponseCallback;
  private onTurnComplete: TurnCompleteCallback;

  constructor(onAudio: AudioResponseCallback, onTurnComplete: TurnCompleteCallback) {
    this.ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    this.onAudio = onAudio;
    this.onTurnComplete = onTurnComplete;
  }

  async connect(): Promise<void> {
    const voiceName = env.AI_VOICE;

    this.session = await this.ai.live.connect({
      model: "gemini-2.5-flash-native-audio-preview-12-2025",
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
        // Using default VAD settings (no custom realtimeInputConfig)
        systemInstruction:
          "You are a friendly AI assistant answering a call on a rotary telephone. " +
          "Keep responses concise and conversational. The caller is using a vintage rotary phone, " +
          "so audio quality may be limited — there will be background noise and static on the line. " +
          "Do not interpret line noise as the caller trying to speak. Be warm, helpful, and to the point.",
      },
      callbacks: {
        onopen: () => {
          log("Gemini Live session connected");
        },
        onmessage: (message) => {
          const content = message.serverContent;
          if (content?.modelTurn?.parts) {
            for (const part of content.modelTurn.parts) {
              if (part.inlineData?.data) {
                const pcmData = Buffer.from(part.inlineData.data, "base64");
                this.onAudio(pcmData);
              }
            }
          }
          if (content?.turnComplete) {
            this.onTurnComplete();
          }
        },
        onerror: (e: any) => {
          logError(`Gemini error: ${e.message || JSON.stringify(e)}`);
        },
        onclose: (e: any) => {
          log(`Gemini Live session closed: code=${e?.code} reason=${e?.reason}`);
        },
      },
    });

    log("Gemini Live session ready");
  }

  /**
   * Send a text message to Gemini to trigger a response.
   */
  sendText(text: string): void {
    if (!this.session) return;
    this.session.sendClientContent({
      turns: [{ role: "user", parts: [{ text }] }],
      turnComplete: true,
    });
  }

  /**
   * Send a chunk of 16kHz PCM audio to Gemini.
   */
  sendAudio(pcm16kHz: Buffer): void {
    if (!this.session) {
      logError("sendAudio called but session is null!");
      return;
    }
    try {
      this.session.sendRealtimeInput({
        audio: {
          data: pcm16kHz.toString("base64"),
          mimeType: "audio/pcm;rate=16000",
        },
      });
    } catch (err) {
      logError(`sendAudio error: ${err}`);
    }
  }

  close(): void {
    if (this.session) {
      this.session.close();
      this.session = null;
    }
  }
}
