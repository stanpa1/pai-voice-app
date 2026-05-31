import React, { useEffect, useRef, useState } from 'react';
import { streamConverse } from '../services/duckTalkClient';

interface ChatPanelProps {
  onBack: () => void;
  paiApiUrl: string;
  paiToken: string;
}

type Role = 'user' | 'assistant' | 'system';
type BackendMode = 'ducktalk' | 'pai';
type VoiceState = 'idle' | 'listening' | 'speaking';
type VoiceLanguage = 'pl-PL' | 'en-US';

const ttsVoiceOptions = [
  { value: '', label: 'Auto' },
  { value: 'pl-PL-Chirp3-HD-Aoede', label: 'Aoede PL · żeński · HD' },
  { value: 'pl-PL-Chirp3-HD-Puck', label: 'Puck PL · męski · HD' },
  { value: 'pl-PL-Chirp3-HD-Kore', label: 'Kore PL · żeński · HD' },
  { value: 'pl-PL-Chirp3-HD-Charon', label: 'Charon PL · męski · HD' },
  { value: 'pl-PL-Wavenet-G', label: 'Wavenet G PL · męski · szybki' },
  { value: 'pl-PL-Standard-G', label: 'Standard G PL · męski · najszybszy' },
  { value: 'en-US-Chirp3-HD-Aoede', label: 'Aoede EN · female · HD' },
  { value: 'en-US-Chirp3-HD-Puck', label: 'Puck EN · male · HD' },
  { value: 'en-US-Wavenet-D', label: 'Wavenet D EN · male · fast' },
];

interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  meta?: string;
}

const CHAT_SESSION_KEY = 'pai-chat-hermes-session-id-v3';
const CHAT_HISTORY_KEY = 'pai-chat-history';
const TTS_VOICE_KEY = 'pai-chat-tts-voice';
const TTS_SPEED_KEY = 'pai-chat-tts-speed';

const quickPrompts = [
  { label: 'Daily brief', text: 'Daj mi krótki daily brief.' },
  { label: 'Projekty', text: 'Podsumuj moje aktywne projekty i następne akcje.' },
  { label: 'Szukaj notatek', text: 'Pomóż mi znaleźć notatki o: ' },
  { label: 'Zapisz notatkę', text: 'Zapisz jako notatkę w Note list: ' },
];

const newId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const initialSessionId = () => localStorage.getItem(CHAT_SESSION_KEY);

const supportsSpeechRecognition = () => (
  typeof window !== 'undefined'
  && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
);

const detectTextLanguage = (text: string): string => {
  const polishPattern = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]|(\b(jest|nie|tak|jak|się|czy|ale|mam|masz|będzie|dzisiaj|jutro|projekt|dobry|cześć|hej)\b)/i;
  return polishPattern.test(text) ? 'pl-PL' : 'en-US';
};

export function ChatPanel({ onBack, paiApiUrl, paiToken }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem(CHAT_HISTORY_KEY);
    if (!saved) {
      return [{
        id: newId(),
        role: 'system',
        text: 'Rozmowa z Hermesem przez DuckTalk. Możesz pisać albo użyć przycisku mikrofonu.',
      }];
    }
    try {
      return JSON.parse(saved) as ChatMessage[];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState('');
  const [backend, setBackend] = useState<BackendMode>('ducktalk');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [voiceLanguage, setVoiceLanguage] = useState<VoiceLanguage>('pl-PL');
  const [ttsVoice, setTtsVoice] = useState(() => localStorage.getItem(TTS_VOICE_KEY) || '');
  const [ttsSpeed, setTtsSpeed] = useState(() => {
    const savedSpeed = Number(localStorage.getItem(TTS_SPEED_KEY));
    return Number.isFinite(savedSpeed) && savedSpeed >= 0.75 && savedSpeed <= 1.5 ? savedSpeed : 1.08;
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (sessionId) {
      localStorage.setItem(CHAT_SESSION_KEY, sessionId);
    } else {
      localStorage.removeItem(CHAT_SESSION_KEY);
    }
  }, [sessionId]);

  useEffect(() => {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messages.slice(-80)));
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    localStorage.setItem(TTS_VOICE_KEY, ttsVoice);
  }, [ttsVoice]);

  useEffect(() => {
    localStorage.setItem(TTS_SPEED_KEY, String(ttsSpeed));
  }, [ttsSpeed]);

  useEffect(() => () => {
    abortRef.current?.abort();
    try { recognitionRef.current?.abort(); } catch { /* noop */ }
    window.speechSynthesis?.cancel();
    if (audioRef.current) audioRef.current.pause();
  }, []);

  const updateMessage = (id: string, update: Partial<ChatMessage>) => {
    setMessages(prev => prev.map(m => (m.id === id ? { ...m, ...update } : m)));
  };

  const appendMessage = (message: Omit<ChatMessage, 'id'>) => {
    const id = newId();
    setMessages(prev => [...prev, { id, ...message }]);
    return id;
  };

  const stopSpeaking = () => {
    window.speechSynthesis?.cancel();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setVoiceState('idle');
  };

  const speakText = async (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    stopSpeaking();
    setVoiceState('speaking');

    try {
      const language = ttsVoice ? ttsVoice.slice(0, 5) : detectTextLanguage(clean);
      const payload: Record<string, string | number> = {
        text: clean,
        language,
        speed: ttsSpeed,
      };
      if (ttsVoice) payload.voice = ttsVoice;

      const res = await fetch(`${paiApiUrl}/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${paiToken}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`TTS API error: ${res.status}`);
      const data = await res.json();
      const audio = new Audio(`data:audio/mp3;base64,${data.audio}`);
      audioRef.current = audio;
      audio.onended = () => { audioRef.current = null; setVoiceState('idle'); };
      audio.onerror = () => { audioRef.current = null; setVoiceState('idle'); };
      await audio.play();
    } catch {
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.lang = detectTextLanguage(clean);
      utterance.rate = ttsSpeed;
      utterance.onend = () => setVoiceState('idle');
      utterance.onerror = () => setVoiceState('idle');
      window.speechSynthesis.speak(utterance);
    }
  };

  const resetChat = async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    stopSpeaking();
    try { recognitionRef.current?.abort(); } catch { /* noop */ }
    setVoiceState('idle');
    setSessionId(null);
    setMessages([{ id: newId(), role: 'system', text: 'Nowa sesja rozmowy.' }]);
    setInput('');
    setError(null);

    if (backend === 'pai') {
      try {
        await fetch(`${paiApiUrl}/voice-chat/reset`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${paiToken}`,
          },
          body: JSON.stringify({ voice_session_id: newId() }),
        });
      } catch {
        // best effort only
      }
    }
  };

  const sendViaPaiFallback = async (text: string, assistantId: string): Promise<string> => {
    const fallbackSessionId = sessionId || newId();
    if (!sessionId) setSessionId(fallbackSessionId);
    const res = await fetch(`${paiApiUrl}/voice-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${paiToken}`,
      },
      body: JSON.stringify({ message: text, voice_session_id: fallbackSessionId }),
    });

    if (!res.ok) throw new Error(`PAI request failed (${res.status}): ${await res.text()}`);
    const data = await res.json();
    const responseText = data.response || data.result || data.message || JSON.stringify(data, null, 2);
    updateMessage(assistantId, { text: responseText, meta: 'PAI fallback' });
    return responseText;
  };

  const sendMessage = async (overrideText?: string, speakAfter = false): Promise<string | null> => {
    const text = (overrideText ?? input).trim();
    if (!text || isSending) return null;

    setInput('');
    setError(null);
    setIsSending(true);
    appendMessage({ role: 'user', text });
    const assistantId = appendMessage({ role: 'assistant', text: '', meta: backend === 'ducktalk' ? 'DuckTalk streaming...' : 'PAI...' });
    const controller = new AbortController();
    abortRef.current = controller;
    let finalResponse: string | null = null;

    const sendViaDuckTalk = async (sessionToUse: string | null, metaPrefix = 'DuckTalk') => {
      let accumulated = '';
      let duckTalkError: string | null = null;

      await streamConverse(
        text,
        sessionToUse,
        {
          onChunk: chunk => {
            accumulated += chunk;
            finalResponse = accumulated;
            updateMessage(assistantId, { text: accumulated, meta: `${metaPrefix} streaming...` });
          },
          onDone: (returnedSessionId, costUsd, durationMs) => {
            if (returnedSessionId) setSessionId(returnedSessionId);
            finalResponse = accumulated || '(brak treści)';
            updateMessage(assistantId, {
              text: finalResponse,
              meta: `DuckTalk · $${(costUsd || 0).toFixed(4)} · ${Math.round((durationMs || 0) / 1000)}s`,
            });
          },
          onError: msg => {
            duckTalkError = msg;
          },
        },
        controller.signal,
        'hermes',
      );

      if (duckTalkError) throw new Error(duckTalkError);
      if (!finalResponse) throw new Error('DuckTalk returned no response');
    };

    const isExpiredDuckTalkSession = (e: any) => {
      const msg = String(e?.message || e || '');
      return /No conversation found|--resume requires a valid session ID|Session IDs must be/i.test(msg);
    };

    try {
      if (backend === 'ducktalk') {
        try {
          await sendViaDuckTalk(sessionId);
        } catch (duckTalkError: any) {
          if (sessionId && isExpiredDuckTalkSession(duckTalkError)) {
            setSessionId(null);
            localStorage.removeItem(CHAT_SESSION_KEY);
            updateMessage(assistantId, { text: '', meta: 'DuckTalk session expired — retrying new session...' });
            finalResponse = null;
            await sendViaDuckTalk(null, 'DuckTalk new session');
          } else {
            throw duckTalkError;
          }
        }
      } else {
        finalResponse = await sendViaPaiFallback(text, assistantId);
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        finalResponse = 'Przerwano.';
        updateMessage(assistantId, { text: finalResponse, meta: 'stopped' });
      } else if (backend === 'ducktalk') {
        try {
          updateMessage(assistantId, { text: 'DuckTalk nie odpowiedział. Próbuję PAI fallback...', meta: 'fallback' });
          finalResponse = await sendViaPaiFallback(text, assistantId);
        } catch (fallbackError: any) {
          const msg = fallbackError?.message || e?.message || 'Request failed';
          setError(msg);
          finalResponse = `Błąd: ${msg}`;
          updateMessage(assistantId, { text: finalResponse, meta: 'error' });
        }
      } else {
        const msg = e?.message || 'Request failed';
        setError(msg);
        finalResponse = `Błąd: ${msg}`;
        updateMessage(assistantId, { text: finalResponse, meta: 'error' });
      }
    } finally {
      setIsSending(false);
      abortRef.current = null;
    }

    if (speakAfter && finalResponse && !finalResponse.startsWith('Błąd:') && finalResponse !== 'Przerwano.') {
      void speakText(finalResponse);
    }
    return finalResponse;
  };

  const startVoiceInput = async () => {
    if (voiceState === 'listening') {
      try { recognitionRef.current?.stop(); } catch { /* noop */ }
      setVoiceState('idle');
      return;
    }

    stopSpeaking();
    setError(null);

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => stream.getTracks().forEach(t => t.stop()));
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) throw new Error('Speech recognition not supported. Use Chrome/Edge.');

      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = voiceLanguage;
      let finalTranscript = '';

      recognition.onstart = () => setVoiceState('listening');
      recognition.onresult = (event: any) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalTranscript += transcript;
          else interim += transcript;
        }
        setInput((finalTranscript + interim).trim());
      };
      recognition.onerror = (event: any) => {
        if (event.error !== 'aborted' && event.error !== 'no-speech') {
          setError(`STT error: ${event.error}`);
        }
        setVoiceState('idle');
      };
      recognition.onend = () => {
        setVoiceState('idle');
        const spoken = finalTranscript.trim();
        if (spoken) void sendMessage(spoken, autoSpeak);
      };
      recognition.start();
    } catch (e: any) {
      setVoiceState('idle');
      setError(e?.message || 'Microphone failed');
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    try { recognitionRef.current?.abort(); } catch { /* noop */ }
    stopSpeaking();
  };

  const voiceStatus = voiceState === 'listening'
    ? 'Słucham — mów teraz'
    : voiceState === 'speaking'
      ? 'Czytam odpowiedź'
      : isSending
        ? 'Hermes odpowiada'
        : 'Gotowy do rozmowy';

  const speechRecognitionAvailable = supportsSpeechRecognition();

  return (
    <div className="h-full flex flex-col bg-gray-900 text-white">
      <header className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-gray-800 bg-gray-900/95 backdrop-blur">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 text-gray-500 hover:text-gray-200 rounded-lg hover:bg-gray-800" title="Back">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <h2 className="font-semibold text-gray-100">Hermes / PAI Chat</h2>
            <p className="text-xs text-gray-500">Session {sessionId ? sessionId.slice(0, 8) : 'new'} · {backend === 'ducktalk' ? 'DuckTalk SSE' : 'PAI voice-chat'} · {voiceStatus}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={backend}
            onChange={e => setBackend(e.target.value as BackendMode)}
            disabled={isSending || voiceState === 'listening'}
            className="bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="ducktalk">DuckTalk</option>
            <option value="pai">PAI fallback</option>
          </select>
          <button onClick={resetChat} disabled={isSending} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-xs rounded border border-gray-700 disabled:opacity-50">
            New chat
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
        {messages.map(message => (
          <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] md:max-w-[72%] rounded-2xl px-4 py-3 border ${
              message.role === 'user'
                ? 'bg-indigo-600/80 border-indigo-500/50 text-white'
                : message.role === 'system'
                  ? 'bg-gray-950/70 border-gray-800 text-gray-400'
                  : 'bg-gray-800/80 border-gray-700 text-gray-100'
            }`}>
              <div className="text-[10px] uppercase tracking-wider opacity-50 mb-1">
                {message.role === 'user' ? 'Ty' : message.role === 'system' ? 'System' : 'Hermes / PAI'}
                {message.meta ? ` · ${message.meta}` : ''}
              </div>
              <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {message.text || (message.role === 'assistant' ? <span className="text-gray-500 animate-pulse">piszę...</span> : null)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="mx-4 mb-3 p-3 rounded-lg bg-red-950/70 border border-red-800 text-red-200 text-sm">
          {error}
        </div>
      )}

      <div className="px-4 pb-3 space-y-3">
        <div className={`rounded-2xl border p-3 flex flex-col sm:flex-row sm:items-center gap-3 ${
          voiceState === 'listening'
            ? 'bg-red-950/40 border-red-700/70'
            : voiceState === 'speaking'
              ? 'bg-indigo-950/40 border-indigo-700/70'
              : 'bg-gray-950/70 border-gray-800'
        }`}>
          <button
            type="button"
            onClick={startVoiceInput}
            disabled={isSending || voiceState === 'speaking' || !speechRecognitionAvailable}
            className={`h-14 px-6 rounded-2xl text-base font-semibold border disabled:opacity-50 disabled:cursor-not-allowed ${
              voiceState === 'listening'
                ? 'bg-red-700 hover:bg-red-600 border-red-500 text-white animate-pulse'
                : 'bg-indigo-600 hover:bg-indigo-500 border-indigo-400/60 text-white'
            }`}
            title="Push to talk"
          >
            {voiceState === 'listening' ? '■ Stop mic' : '🎙️ Mów'}
          </button>

          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-100">{voiceStatus}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {speechRecognitionAvailable
                ? 'Kliknij Mów, powiedz komendę, a po zakończeniu rozpoznawania wyślę ją do Hermesa.'
                : 'Rozpoznawanie mowy wymaga Chrome/Edge z Web Speech API.'}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
            <label className="flex items-center gap-2 select-none">
              <input type="checkbox" checked={autoSpeak} onChange={e => setAutoSpeak(e.target.checked)} className="accent-indigo-500" />
              czytaj odpowiedzi
            </label>
            <label className="flex items-center gap-2">
              STT
              <select
                value={voiceLanguage}
                onChange={e => setVoiceLanguage(e.target.value as VoiceLanguage)}
                disabled={voiceState === 'listening'}
                className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-gray-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="pl-PL">PL</option>
                <option value="en-US">EN</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              głos
              <select
                value={ttsVoice}
                onChange={e => setTtsVoice(e.target.value)}
                disabled={voiceState === 'speaking'}
                className="max-w-[15rem] bg-gray-900 border border-gray-700 rounded px-2 py-1 text-gray-200 focus:outline-none focus:border-indigo-500"
              >
                {ttsVoiceOptions.map(option => (
                  <option key={option.value || 'auto'} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              tempo {ttsSpeed.toFixed(2)}×
              <input
                type="range"
                min="0.85"
                max="1.30"
                step="0.01"
                value={ttsSpeed}
                onChange={e => setTtsSpeed(Number(e.target.value))}
                disabled={voiceState === 'speaking'}
                className="w-24 accent-indigo-500"
              />
            </label>
            <button
              type="button"
              onClick={() => { setTtsVoice('pl-PL-Chirp3-HD-Aoede'); setTtsSpeed(1.08); }}
              disabled={voiceState === 'speaking'}
              className="px-2 py-1 rounded bg-gray-900 border border-gray-700 hover:border-indigo-500 text-gray-300 disabled:opacity-50"
            >
              jakość
            </button>
            <button
              type="button"
              onClick={() => { setTtsVoice('pl-PL-Wavenet-G'); setTtsSpeed(1.15); }}
              disabled={voiceState === 'speaking'}
              className="px-2 py-1 rounded bg-gray-900 border border-gray-700 hover:border-indigo-500 text-gray-300 disabled:opacity-50"
            >
              szybki głos
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
        {quickPrompts.map(prompt => (
          <button
            key={prompt.label}
            onClick={() => setInput(prompt.text)}
            disabled={isSending || voiceState === 'listening'}
            className="px-3 py-1.5 rounded-full bg-gray-800 hover:bg-gray-700 border border-gray-700 text-xs text-gray-300 disabled:opacity-50"
          >
            {prompt.label}
          </button>
        ))}
        </div>
      </div>

      <form
        className="p-4 border-t border-gray-800 bg-gray-950/70 flex flex-col sm:flex-row sm:items-end gap-2"
        onSubmit={e => {
          e.preventDefault();
          void sendMessage(input, autoSpeak);
        }}
      >
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void sendMessage(input, autoSpeak);
            }
          }}
          rows={2}
          placeholder={voiceState === 'listening' ? 'Słucham...' : 'Napisz albo kliknij Mów...'}
          className="flex-1 resize-none bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          disabled={isSending}
        />
        {(isSending || voiceState === 'speaking') ? (
          <button type="button" onClick={stop} className="w-full sm:w-auto px-5 py-3 rounded-xl bg-red-700 hover:bg-red-600 text-sm font-medium">
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()} className="w-full sm:w-auto px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
            Send
          </button>
        )}
      </form>
    </div>
  );
}
