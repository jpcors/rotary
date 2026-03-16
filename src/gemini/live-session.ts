import { GoogleGenAI, Modality, type Session, type FunctionCall } from "@google/genai";
import { env } from "../lib/config.js";
import { log, logError } from "../lib/logger.js";
import { type AgentConfig, buildSystemInstruction } from "../lib/agent.js";
import type { Tool } from "../tools/types.js";

export type AudioResponseCallback = (pcm24kHz: Buffer) => void;
export type TurnCompleteCallback = () => void;

export class GeminiLiveSession {
  private ai: GoogleGenAI;
  private session: Session | null = null;
  private onAudio: AudioResponseCallback;
  private onTurnComplete: TurnCompleteCallback;
  private toolMap: Map<string, Tool>;

  private agentConfig: AgentConfig;

  constructor(
    onAudio: AudioResponseCallback,
    onTurnComplete: TurnCompleteCallback,
    tools: Tool[] = [],
    agentConfig: AgentConfig = { name: "Rotary", personality: "You are a friendly AI assistant." }
  ) {
    this.ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    this.onAudio = onAudio;
    this.onTurnComplete = onTurnComplete;
    this.agentConfig = agentConfig;
    this.toolMap = new Map(
      tools.filter((t) => t.declaration.name).map((t) => [t.declaration.name!, t])
    );
  }

  async connect(): Promise<void> {
    const voiceName = env.AI_VOICE;

    const tools = this.toolMap.size > 0
      ? [{ functionDeclarations: [...this.toolMap.values()].map((t) => t.declaration) }]
      : undefined;

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
        systemInstruction: buildSystemInstruction(this.agentConfig),
        tools,
      },
      callbacks: {
        onopen: () => {
          log("Gemini Live session connected");
        },
        onmessage: (message) => {
          // Handle audio responses
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

          // Handle function calls
          if (message.toolCall?.functionCalls) {
            this.handleFunctionCalls(message.toolCall.functionCalls);
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

  private async handleFunctionCalls(functionCalls: FunctionCall[]): Promise<void> {
    const responses = [];

    for (const call of functionCalls) {
      const name = call.name ?? "unknown";
      const tool = this.toolMap.get(name);
      if (!tool) {
        logError(`Unknown function call: ${name}`);
        responses.push({
          id: call.id,
          name,
          response: { error: `Unknown function: ${name}` },
        });
        continue;
      }

      log(`Executing tool: ${name}(${JSON.stringify(call.args)})`);

      try {
        const result = await tool.handler(call.args ?? {});
        log(`Tool result: ${JSON.stringify(result)}`);
        responses.push({
          id: call.id,
          name,
          response: result,
        });
      } catch (err: any) {
        logError(`Tool execution error: ${err.message}`);
        responses.push({
          id: call.id,
          name,
          response: { error: err.message },
        });
      }
    }

    if (this.session && responses.length > 0) {
      this.session.sendToolResponse({ functionResponses: responses });
    }
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
