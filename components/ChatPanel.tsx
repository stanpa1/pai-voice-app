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

interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  meta?: string;
}

const CHAT_SESSION_KEY = 'pai-chat-hermes-session-id-v3';
const CHAT_HISTORY_KEY = 'pai-chat-history';

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
      const res = await fetch(`${paiApiUrl}/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${paiToken}`,
        },
        body: JSON.stringify({ text: clean }),
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

    try {
      if (backend === 'ducktalk') {
        let accumulated = '';
        await streamConverse(
          text,
          sessionId,
          {
            onChunk: chunk => {
              accumulated += chunk;
              finalResponse = accumulated;
              updateMessage(assistantId, { text: accumulated, meta: 'DuckTalk streaming...' });
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
              throw new Error(msg);
            },
          },
          controller.signal,
          'hermes',
        );
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
      recognition.lang = 'pl-PL';
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

  return (
    <div className="h-full flex flex-col bg-gray-900 text-white">
      <header className="px-4 py-3 flex items-center justify-between border-b border-gray-800 bg-gray-900/95 backdrop-blur">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 text-gray-500 hover:text-gray-200 rounded-lg hover:bg-gray-800" title="Back">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <h2 className="font-semibold text-gray-100">Hermes / PAI Chat</h2>
            <p className="text-xs text-gray-500">Session {sessionId ? sessionId.slice(0, 8) : 'new'} · {backend === 'ducktalk' ? 'DuckTalk SSE' : 'PAI voice-chat'} · {voiceState}</p>
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

      <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
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
        <label className="ml-auto flex items-center gap-2 text-xs text-gray-400 select-none">
          <input type="checkbox" checked={autoSpeak} onChange={e => setAutoSpeak(e.target.checked)} className="accent-indigo-500" />
          czytaj odpowiedzi
        </label>
      </div>

      <form
        className="p-4 border-t border-gray-800 bg-gray-950/70 flex items-end gap-2"
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
          placeholder={voiceState === 'listening' ? 'Słucham...' : 'Napisz albo kliknij mikrofon...'}
          className="flex-1 resize-none bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          disabled={isSending}
        />
        <button
          type="button"
          onClick={startVoiceInput}
          disabled={isSending || voiceState === 'speaking'}
          className={`px-4 py-3 rounded-xl text-sm font-medium border disabled:opacity-50 ${
            voiceState === 'listening'
              ? 'bg-red-700 hover:bg-red-600 border-red-500 text-white animate-pulse'
              : 'bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-100'
          }`}
          title="Push to talk"
        >
          {voiceState === 'listening' ? 'Stop mic' : '🎙️'}
        </button>
        {(isSending || voiceState === 'speaking') ? (
          <button type="button" onClick={stop} className="px-5 py-3 rounded-xl bg-red-700 hover:bg-red-600 text-sm font-medium">
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()} className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
            Send
          </button>
        )}
      </form>
    </div>
  );
}
