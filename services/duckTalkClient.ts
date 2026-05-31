/**
 * DuckTalk Client — Single Gemini Live session + Claude Code backend via SSE.
 *
 * Architecture:
 * - One Gemini Live session handles both STT and TTS
 * - User speaks → Gemini calls `converse` tool (BLOCKING)
 * - SSE streams Claude Code response from backend
 * - Full response sent as tool result → Gemini reads it aloud
 */

import {
  GoogleGenAI,
  Modality,
  Type,
  type Session,
  type LiveServerMessage,
  type Tool,
} from '@google/genai';
import { float32ToPCM16, decodeBase64 } from '../utils/audioUtils';
import { SystemConfig, VoiceName } from '../types';

// --- Config ---
const DUCKTALK_API_URL = import.meta.env.VITE_DUCKTALK_API_URL || 'https://api.stankowski.io/ducktalk/api';
const PAI_API_TOKEN = import.meta.env.VITE_PAI_API_TOKEN || '';
const GEMINI_MODEL = 'gemini-3.1-flash-live-preview';

const SYSTEM_PROMPT = `You are a voice relay between a user and an AI assistant called PAI.

RULES:
1. When the user gives an instruction or asks a question, call the converse tool with the full instruction.
2. When the user wants to cancel (e.g. "stop", "cancel", "nevermind"), call the stop tool.
3. After receiving the converse tool result, READ THE RESULT ALOUD to the user naturally. Do not add your own commentary — just read what PAI said.
4. Pass through the EXACT words the user says — do not rephrase or summarize.
5. Match the language of the response (Polish or English).

You are a bridge. The user is talking TO PAI THROUGH you.`;

const TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: 'converse',
        description: 'Forward a user instruction to PAI for processing. The result will contain PAI\'s response text that you should read aloud.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            instruction: { type: Type.STRING, description: 'The user instruction to forward to PAI' },
          },
          required: ['instruction'],
        },
      },
      {
        name: 'stop',
        description: 'Stop the current operation. Use when user says stop, cancel, or nevermind.',
        parameters: { type: Type.OBJECT, properties: {} },
      },
    ],
  },
];

// --- PCM Player (gapless playback) ---

interface Player {
  play(base64: string): void;
  flush(): void;
  stop(): void;
}

function createPlayer(): Player {
  const ctx = new AudioContext({ sampleRate: 24000 });
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  let nextTime = 0;
  let sources: AudioBufferSourceNode[] = [];

  return {
    play(base64: string) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const bytes = decodeBase64(base64);
      const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }

      const buffer = ctx.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);

      const start = Math.max(ctx.currentTime + 0.01, nextTime);
      src.start(start);
      nextTime = start + buffer.duration;

      sources.push(src);
      src.onended = () => {
        sources = sources.filter((s) => s !== src);
      };
    },
    flush() {
      for (const s of sources) {
        try { s.stop(); } catch { /* already stopped */ }
      }
      sources = [];
      nextTime = 0;
    },
    stop() {
      this.flush();
      if (ctx.state !== 'closed') void ctx.close();
    },
  };
}

// --- SSE Client ---

export interface ConverseCallbacks {
  onChunk: (text: string) => void;
  onDone?: (sessionId: string, costUsd: number, durationMs: number) => void;
  onError: (msg: string) => void;
}

export async function streamConverse(
  instruction: string,
  sessionId: string | null,
  callbacks: ConverseCallbacks,
  signal?: AbortSignal,
  persona?: 'pai' | 'hermes',
): Promise<void> {
  try {
    const res = await fetch(`${DUCKTALK_API_URL}/converse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PAI_API_TOKEN}`,
      },
      body: JSON.stringify({
        instruction,
        session_id: sessionId,
        persona,
      }),
      signal,
    });

    if (!res.ok || !res.body) {
      callbacks.onError(`Backend request failed (${res.status})`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const parts = buf.split('\n\n');
      buf = parts.pop()!;

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data: ')) continue;
        const data = JSON.parse(line.slice(6));
        if (data.text) {
          callbacks.onChunk(data.text);
        }
        if (data.done) {
          if (data.error) {
            callbacks.onError(`Claude error: ${data.error}`);
          } else {
            callbacks.onDone?.(data.session_id, data.cost_usd, data.duration_ms);
          }
        }
      }
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') {
      callbacks.onError('Backend request failed');
    }
  }
}

// --- Main Client ---

export interface DuckTalkCallbacks {
  onOpen: () => void;
  onClose: () => void;
  onError: (err: Error) => void;
  onAudioData: (volume: number) => void;
  onTranscript: (role: 'user' | 'model', text: string) => void;
}

export class DuckTalkClient {
  private apiKey: string;
  private config: SystemConfig;
  private callbacks: DuckTalkCallbacks;

  private session: Session | null = null;
  private player: Player;
  private closed = false;
  private sessionId: string | null = null;
  private abortController: AbortController | null = null;

  // Mic
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;

  constructor(apiKey: string, config: SystemConfig, callbacks: DuckTalkCallbacks) {
    this.apiKey = apiKey;
    this.config = config;
    this.callbacks = callbacks;
    this.player = createPlayer();
  }

  async connect(): Promise<void> {
    this.closed = false;

    const ai = new GoogleGenAI({ apiKey: this.apiKey });

    try {
      const session = await ai.live.connect({
        model: GEMINI_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          tools: TOOLS,
          systemInstruction: SYSTEM_PROMPT,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: this.config.voiceName } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            console.log('[DuckTalk] connected');
            this.callbacks.onOpen();
          },
          onmessage: (msg: LiveServerMessage) => this.handleMessage(msg),
          onerror: (e: ErrorEvent) => {
            console.error('[DuckTalk] error', e);
            this.callbacks.onError(new Error(e.message));
          },
          onclose: (e: CloseEvent) => {
            console.log('[DuckTalk] closed:', e.reason || 'normal');
            this.cleanup();
            this.callbacks.onClose();
          },
        },
      });

      this.session = session;
      await this.startMic();
    } catch (e) {
      this.callbacks.onError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private async startMic(): Promise<void> {
    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioContext = new AudioContext({ sampleRate: 16000 });
    if (this.audioContext.state === 'suspended') await this.audioContext.resume();
    const source = this.audioContext.createMediaStreamSource(this.mediaStream);

    this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
    source.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.audioContext.destination);

    this.scriptProcessor.onaudioprocess = (e: AudioProcessingEvent) => {
      if (this.closed || !this.session) return;

      const inputData = e.inputBuffer.getChannelData(0);

      // Volume for visualizer
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        sum += inputData[i] * inputData[i];
      }
      this.callbacks.onAudioData(Math.sqrt(sum / inputData.length));

      // Send audio to Gemini
      const pcm = float32ToPCM16(inputData);
      this.session.sendRealtimeInput({
        audio: { data: pcm.data, mimeType: pcm.mimeType },
      });
    };
  }

  private handleMessage(message: LiveServerMessage): void {
    // --- Tool calls ---
    if (message.toolCall?.functionCalls) {
      for (const fc of message.toolCall.functionCalls) {
        console.log(`[DuckTalk] tool: ${fc.name}`, fc.args);

        if (fc.name === 'stop') {
          this.abortController?.abort();
          this.player.flush();
          this.session?.sendToolResponse({
            functionResponses: [{ id: fc.id!, name: 'stop', response: { result: 'stopped' } }],
          });
          continue;
        }

        if (fc.name === 'converse') {
          const instruction = String((fc.args as Record<string, unknown>)?.instruction ?? '');

          // Abort any previous converse
          this.abortController?.abort();
          this.player.flush();

          // Emit user transcript
          this.callbacks.onTranscript('user', instruction);

          // Stream Claude response, send as tool result when done
          this.abortController = new AbortController();
          let fullResponse = '';
          const toolCallId = fc.id!;

          streamConverse(instruction, this.sessionId, {
            onChunk: (text) => {
              fullResponse += text;
            },
            onDone: (sid, cost, duration) => {
              this.sessionId = sid;
              console.log(`[DuckTalk] Claude done: cost=$${cost}, ${duration}ms`);

              // Clean response
              const cleanResponse = fullResponse
                .replace(/[📋🔍⚡✅➡️🗣️][^\n]*/g, '')
                .replace(/\n{2,}/g, '\n')
                .trim();

              // Emit transcript
              this.callbacks.onTranscript('model', cleanResponse);

              // Send as tool result → Gemini reads aloud
              if (this.session && !this.closed) {
                this.session.sendToolResponse({
                  functionResponses: [{
                    id: toolCallId,
                    name: 'converse',
                    response: { result: cleanResponse },
                  }],
                });
              }
            },
            onError: (msg) => {
              console.error('[DuckTalk] Claude error:', msg);
              this.callbacks.onTranscript('model', `Error: ${msg}`);
              this.session?.sendToolResponse({
                functionResponses: [{
                  id: toolCallId,
                  name: 'converse',
                  response: { result: `Sorry, there was an error: ${msg}` },
                }],
              });
            },
          }, this.abortController.signal);
        }
      }
      return;
    }

    // --- Audio output (Gemini TTS) ---
    if (message.serverContent?.modelTurn?.parts) {
      for (const p of message.serverContent.modelTurn.parts) {
        if (p.inlineData?.data && !this.closed) {
          this.player.play(p.inlineData.data);
        }
      }
    }

    // --- Transcription ---
    if (message.serverContent?.inputTranscription?.text) {
      console.log(`[DuckTalk] [user] ${message.serverContent.inputTranscription.text}`);
    }
    if (message.serverContent?.outputTranscription?.text) {
      console.log(`[DuckTalk] [model] ${message.serverContent.outputTranscription.text}`);
    }

    // --- Interrupted ---
    if (message.serverContent?.interrupted) {
      this.abortController?.abort();
      this.player.flush();
    }

    // --- GoAway ---
    if (message.goAway) {
      console.log('[DuckTalk] goAway');
    }
  }

  async disconnect(): Promise<void> {
    this.cleanup();
  }

  private cleanup(): void {
    this.closed = true;
    this.abortController?.abort();
    this.player.stop();

    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      void this.audioContext.close();
      this.audioContext = null;
    }

    this.session?.close();
    this.session = null;
  }
}
