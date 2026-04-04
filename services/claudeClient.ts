import { SystemConfig, ClaudeState } from '../types';

const PAI_API_URL = import.meta.env.VITE_PAI_API_URL || 'https://api.stankowski.io/api';
const PAI_API_TOKEN = import.meta.env.VITE_PAI_API_TOKEN || '';

const SILENCE_TIMEOUT_MS = 2500;
const VOICE_SESSION_KEY = 'pai-claude-voice-session-id';

interface ClaudeClientCallbacks {
  onOpen: () => void;
  onClose: () => void;
  onError: (error: Error) => void;
  onAudioData: (amplitude: number) => void;
  onTranscript: (role: 'user' | 'model', text: string) => void;
  onStateChange: (state: ClaudeState) => void;
}

export class ClaudeClient {
  private config: SystemConfig;
  private callbacks: ClaudeClientCallbacks;

  private recognition: any = null; // SpeechRecognition
  private synth: SpeechSynthesis;
  private state: ClaudeState = 'idle';
  private isConnected: boolean = false;

  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingText: string = '';
  private abortController: AbortController | null = null;
  private voiceSessionId: string;
  private volumeInterval: ReturnType<typeof setInterval> | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private audioContext: AudioContext | null = null;

  constructor(config: SystemConfig, callbacks: ClaudeClientCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
    this.synth = window.speechSynthesis;

    // Persistent session ID
    let stored = localStorage.getItem(VOICE_SESSION_KEY);
    if (!stored) {
      stored = 'voice-' + crypto.randomUUID();
      localStorage.setItem(VOICE_SESSION_KEY, stored);
    }
    this.voiceSessionId = stored;
  }

  public async connect() {
    try {
      // Create AudioContext on user gesture (needed for mobile autoplay)
      this.audioContext = new AudioContext();

      // Request mic permission explicitly first (needed on some mobile browsers)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop()); // Release immediately

      // Check Web Speech API support
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        throw new Error('Speech recognition not supported. Please use Chrome.');
      }

      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'pl-PL';

      this.recognition.onresult = (event: any) => this.handleSpeechResult(event);
      this.recognition.onend = () => {
        // Chrome stops continuous recognition after extended silence
        if (this.pendingText.trim() && this.state === 'listening') {
          // Have accumulated text — send it
          if (this.silenceTimer) clearTimeout(this.silenceTimer);
          this.sendToBackend(this.pendingText.trim());
        } else if (this.isConnected && this.state === 'listening') {
          // No text — just restart recognition
          try { this.recognition.start(); } catch (_) {}
        }
      };
      this.recognition.onerror = (event: any) => {
        console.log(`[STT] onerror: ${event.error}`);
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        console.error('Speech recognition error:', event.error);
      };

      this.isConnected = true;
      this.callbacks.onOpen();
      this.startListening();
      this.startVolumeMonitoring();
    } catch (err) {
      this.callbacks.onError(err instanceof Error ? err : new Error('Failed to connect: ' + err));
    }
  }

  public async disconnect() {
    this.isConnected = false;
    this.setState('idle');

    // Stop recognition
    if (this.recognition) {
      this.recognition.onend = null;
      try { this.recognition.stop(); } catch (_) {}
    }

    // Cancel pending request
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Stop TTS
    this.synth.cancel();
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }

    // Stop volume monitoring
    if (this.volumeInterval) {
      clearInterval(this.volumeInterval);
      this.volumeInterval = null;
    }

    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    this.callbacks.onClose();
  }

  public resetSession() {
    const newId = 'voice-' + crypto.randomUUID();
    localStorage.setItem(VOICE_SESSION_KEY, newId);
    this.voiceSessionId = newId;

    // Fire and forget reset on backend
    fetch(`${PAI_API_URL}/voice-chat/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PAI_API_TOKEN}`,
      },
      body: JSON.stringify({ voice_session_id: this.voiceSessionId }),
    }).catch(() => {});
  }

  private setState(state: ClaudeState) {
    this.state = state;
    this.callbacks.onStateChange(state);
  }

  private detectTextLanguage(text: string): string {
    // Polish-specific characters and common words
    const polishPattern = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]|(\b(jest|nie|tak|jak|się|czy|ale|mam|masz|będzie|dzisiaj|jutro|projekt|dobry|cześć|hej)\b)/i;
    return polishPattern.test(text) ? 'pl-PL' : 'en-US';
  }

  private startListening() {
    console.log('[STT] startListening called');
    this.setState('listening');
    this.pendingText = '';
    try { this.recognition.start(); } catch (e) { console.error('[STT] start failed:', e); }
  }

  private handleSpeechResult(event: any) {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0].transcript;

      if (result.isFinal) {
        this.pendingText += text;
        console.log(`[STT] Final: "${this.pendingText}"`);
        this.callbacks.onTranscript('user', this.pendingText);
        // In non-continuous mode, recognition will stop and onend fires → triggers send
      } else {
        // Show interim results
        this.callbacks.onTranscript('user', this.pendingText + text);
      }
    }
  }

  private async sendToBackend(text: string) {
    console.log(`[Claude] sendToBackend: "${text}"`);
    // Stop listening while processing
    try { this.recognition.stop(); } catch (_) {}
    this.setState('processing');

    // Emit final user transcript
    this.callbacks.onTranscript('user', text);

    this.abortController = new AbortController();

    try {
      const response = await fetch(`${PAI_API_URL}/voice-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${PAI_API_TOKEN}`,
        },
        body: JSON.stringify({
          message: text,
          voice_session_id: this.voiceSessionId,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      const responseText = data.response || 'No response';

      this.callbacks.onTranscript('model', responseText);
      this.speakResponse(responseText);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.error('Voice chat error:', err);
      this.callbacks.onError(err instanceof Error ? err : new Error(String(err)));
      // Resume listening on error
      if (this.isConnected) this.startListening();
    }
  }

  private async speakResponse(text: string) {
    this.setState('speaking');

    try {
      // Call Google Cloud TTS via backend
      const response = await fetch(`${PAI_API_URL}/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${PAI_API_TOKEN}`,
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        throw new Error(`TTS API error: ${response.status}`);
      }

      const data = await response.json();

      // Create data URL from base64 MP3
      const audioUrl = `data:audio/mp3;base64,${data.audio}`;
      const audio = new Audio(audioUrl);

      // Unlock audio on mobile by connecting to AudioContext
      if (this.audioContext && this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      if (this.audioContext) {
        const source = this.audioContext.createMediaElementSource(audio);
        source.connect(this.audioContext.destination);
      }

      this.currentAudio = audio;

      audio.onended = () => {
        this.currentAudio = null;
        if (this.isConnected) this.startListening();
      };
      audio.onerror = (e) => {
        console.error('[TTS] Audio playback error:', e);
        this.currentAudio = null;
        if (this.isConnected) this.startListening();
      };

      await audio.play();
    } catch (err) {
      console.error('TTS error, falling back to browser speech:', err);
      // Fallback to browser SpeechSynthesis
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = this.detectTextLanguage(text);
      utterance.onend = () => { if (this.isConnected) this.startListening(); };
      utterance.onerror = () => { if (this.isConnected) this.startListening(); };
      this.synth.speak(utterance);
    }
  }

  private startVolumeMonitoring() {
    this.volumeInterval = setInterval(() => {
      if (this.state === 'listening') {
        // Gentle breathing animation while listening
        this.callbacks.onAudioData(0.08 + Math.sin(Date.now() / 500) * 0.04);
      } else if (this.state === 'speaking') {
        // Active pulse while speaking
        this.callbacks.onAudioData(0.3 + Math.sin(Date.now() / 150) * 0.2);
      } else if (this.state === 'processing') {
        // Subtle pulse while thinking
        this.callbacks.onAudioData(0.12 + Math.sin(Date.now() / 300) * 0.06);
      } else {
        this.callbacks.onAudioData(0.02);
      }
    }, 50);
  }
}
