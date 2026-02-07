import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, SystemConfig, VoiceName, HistoryItem } from './types';
import { SetupPanel } from './components/SetupPanel';
import { Visualizer } from './components/Visualizer';
import { HistoryLog } from './components/HistoryLog';
import { Observatory } from './components/Observatory';
import { LiveClient } from './services/liveClient';

// PAI API Configuration
const PAI_API_URL = import.meta.env.VITE_PAI_API_URL || 'https://api.stankowski.io/api';
const PAI_API_TOKEN = import.meta.env.VITE_PAI_API_TOKEN || '';

interface TranscriptItem {
  role: 'user' | 'model';
  text: string;
  isFinal?: boolean;
}

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

// PAI System Instruction
const PAI_SYSTEM_INSTRUCTION = `You are PAI, a personal AI assistant. Be concise - this is voice, not text. Match the user's language (Polish or English).

IMPORTANT: Do NOT greet with facts, dates, or status updates unless asked. Just listen and respond naturally.

TOOLS (use proactively when relevant):

Memory:
- searchPAI(query, category) - Search past notes, conversations
- getPAIContext() - Get current projects and recent notes
- addPAINote(content, tags) - Save a note or idea

Projects (Notion):
- getProjects(status) - List projects. Use for "jakie mam projekty?" / "what am I working on?"
- updateProject(name, status, next_action, deadline) - Update project. Use for "zrobione" / "done" / deadline changes
- addProject(name, area, priority, next_action, deadline) - Create new project
- weeklyReview() - Get weekly review summary

Deadlines understand natural language: "jutro", "friday", "za tydzień", "15 lutego"

Be helpful but brief. Confirm actions after completing them.`;

export default function App() {
  const [view, setView] = useState<View>(View.SETUP);
  const [config, setConfig] = useState<SystemConfig>({
    systemInstruction: PAI_SYSTEM_INSTRUCTION,
    voiceName: VoiceName.Kore,
    useTools: true,
    webhookUrl: "https://api.stankowski.io/api/voice-session"
  });
  
  // Connection State
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [volume, setVolume] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  // Session Timer
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // History State
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    const saved = localStorage.getItem('pai_voice_history');
    return saved ? JSON.parse(saved) : [];
  });
  
  // Live Transcript State
  const [liveTranscripts, setLiveTranscripts] = useState<TranscriptItem[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const liveClient = useRef<LiveClient | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    localStorage.setItem('pai_voice_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    if (isConnected) {
        setElapsedSeconds(0);
        timerRef.current = window.setInterval(() => {
            setElapsedSeconds(prev => prev + 1);
        }, 1000);
    } else {
        if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
        if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isConnected]);

  // Auto-scroll transcript
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [liveTranscripts]);

  const handleStart = async () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      setError("API Key not found in environment variables.");
      return;
    }

    setIsConnecting(true);
    setError(null);
    setLiveTranscripts([]);
    
    // We use a ref to track the session start time to avoid closure staleness in handleEndSession
    const startTime = Date.now();

    liveClient.current = new LiveClient(apiKey, config, {
      onOpen: () => {
        setIsConnected(true);
        setIsConnecting(false);
        setView(View.ACTIVE_CALL);
      },
      onClose: () => {
        setIsConnected(false);
        handleEndSession(startTime);
        setView(View.SETUP);
      },
      onError: (err) => {
        setError(err.message);
        setIsConnecting(false);
        setIsConnected(false);
        setView(View.SETUP);
      },
      onAudioData: (vol) => {
        setVolume(vol);
      },
      onTranscript: (role, text) => {
        setLiveTranscripts(prev => {
           const last = prev[prev.length - 1];
           // Simple aggregation: if same role, append. Else new bubble.
           if (last && last.role === role) {
             return [...prev.slice(0, -1), { ...last, text: last.text + text }];
           } else {
             return [...prev, { role, text }];
           }
        });
      }
    });

    await liveClient.current.connect();
  };

  const handleDisconnect = async () => {
    if (liveClient.current) {
      await liveClient.current.disconnect();
    }
  };

  const handleEndSession = (startTime: number) => {
    // We need to access the latest liveTranscripts. 
    // Since this is called from a closure (the LiveClient callback), 
    // we should use a functional state update or a ref to get the data.
    // However, setLiveTranscripts is async. 
    // Best way: Use a ref to mirror liveTranscripts for the final save.
    
    // Actually, because handleEndSession is called by onClose which is triggered by handleDisconnect,
    // we can access the state if we are careful. 
    // But to be safe, let's use the setState callback pattern to get the final value
    // OR, better, let's use a ref for transcripts that we update alongside the state.
  };
  
  // Ref to mirror transcripts for safe access during teardown
  const transcriptsRef = useRef<TranscriptItem[]>([]);
  useEffect(() => {
      transcriptsRef.current = liveTranscripts;
  }, [liveTranscripts]);

  const finalSave = (startTime: number) => {
      const finalTranscripts = transcriptsRef.current;
      if (finalTranscripts.length > 0) {
        const newItem: HistoryItem = {
          id: crypto.randomUUID(),
          timestamp: startTime,
          duration: Math.floor((Date.now() - startTime) / 1000),
          transcripts: finalTranscripts
        };
        
        setHistory(prev => [...prev, newItem]);

        if (config.webhookUrl) {
            console.log(`Sending transcript to webhook: ${config.webhookUrl}`);
            const paiToken = import.meta.env.VITE_PAI_API_TOKEN || '';
            fetch(config.webhookUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${paiToken}`
                },
                body: JSON.stringify(newItem)
            }).catch(console.error);
        }
      }
      setVolume(0);
      setElapsedSeconds(0);
  };
  
  // Update the onClose callback to call finalSave
  // We need to recreate the handleStart function to use the new logic? 
  // No, we can just update the LiveClient instantiation inside handleStart.
  // See updated handleStart below.

  return (
    <div className="h-full w-full flex flex-col bg-gray-900 text-white relative">
      {/* Background Ambience */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
         <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-900/20 rounded-full blur-[128px]"></div>
         <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-indigo-900/20 rounded-full blur-[128px]"></div>
      </div>

      <div className="relative z-10 flex-1 flex flex-col">
        
        {/* Header */}
        <header className="px-4 py-3 flex items-center justify-between border-b border-gray-800/30 backdrop-blur-sm z-20">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`}></div>
            <span className="font-medium text-sm text-gray-400">PAI</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setView(View.OBSERVATORY)}
              className="p-2 text-gray-500 hover:text-gray-300 transition-colors rounded-lg hover:bg-gray-800/50"
              title="Observatory"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
            </button>
            <button
              onClick={() => setView(View.HISTORY)}
              className="p-2 text-gray-500 hover:text-gray-300 transition-colors rounded-lg hover:bg-gray-800/50"
              title="History"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </button>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 flex flex-col items-center justify-center p-4 overflow-hidden">
          
          {error && (
            <div className="absolute top-24 left-1/2 transform -translate-x-1/2 w-full max-w-lg z-50 px-4">
              <div className="bg-red-900/90 border border-red-700 text-red-200 px-6 py-4 rounded-xl shadow-xl backdrop-blur flex items-start gap-3">
                 <svg className="w-6 h-6 text-red-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                 <div>
                   <h4 className="font-bold text-red-100">Connection Error</h4>
                   <p className="text-sm mt-1 opacity-90 break-words">{error}</p>
                 </div>
                 <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-white">
                   <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                 </button>
              </div>
            </div>
          )}

          {view === View.SETUP && (
            <div className="w-full h-full flex items-center justify-center overflow-y-auto">
               {isConnecting ? (
                 <div className="flex flex-col items-center gap-4">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
                    <p className="text-blue-400 animate-pulse">Establishing Secure Uplink...</p>
                 </div>
               ) : (
                 <SetupPanel 
                   config={config} 
                   onConfigChange={setConfig} 
                   onStart={() => {
                       // Custom wrapper to pass start time to save function
                       const startTime = Date.now();
                       const apiKey = process.env.API_KEY;
                       if (!apiKey) { setError("API Key missing"); return; }
                       
                       setIsConnecting(true);
                       setError(null);
                       setLiveTranscripts([]);
                       transcriptsRef.current = [];

                       liveClient.current = new LiveClient(apiKey, config, {
                         onOpen: () => {
                           setIsConnected(true);
                           setIsConnecting(false);
                           setView(View.ACTIVE_CALL);
                         },
                         onClose: () => {
                           setIsConnected(false);
                           finalSave(startTime);
                           setView(View.SETUP);
                         },
                         onError: (err) => {
                           setError(err.message);
                           setIsConnecting(false);
                           setIsConnected(false);
                           setView(View.SETUP);
                         },
                         onAudioData: (vol) => setVolume(vol),
                         onTranscript: (role, text) => {
                            setLiveTranscripts(prev => {
                                const last = prev[prev.length - 1];
                                if (last && last.role === role) {
                                    return [...prev.slice(0, -1), { ...last, text: last.text + text }];
                                } else {
                                    return [...prev, { role, text }];
                                }
                            });
                         }
                       });
                       liveClient.current.connect();
                   }} 
                 />
               )}
            </div>
          )}

          {view === View.ACTIVE_CALL && (
            <div className="flex flex-col h-full w-full max-w-4xl gap-6">
              
              {/* Visualizer Section */}
              <div className="flex-1 min-h-[300px] relative flex flex-col items-center justify-center">
                 <Visualizer isActive={isConnected} volume={volume} isAgentTalking={volume > 0.05} />
                 
                 <div className="absolute top-4 bg-gray-900/50 backdrop-blur px-3 py-1 rounded-full border border-gray-700 text-xs font-mono text-gray-400">
                    SESSION: {formatTime(elapsedSeconds)}
                 </div>
              </div>
              
              {/* Live Transcript Log */}
              <div className="h-48 flex-shrink-0 bg-gray-900/50 border border-gray-800 rounded-xl backdrop-blur overflow-hidden flex flex-col">
                  <div className="px-4 py-2 border-b border-gray-800 bg-gray-900/80 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Live Log
                  </div>
                  <div 
                    ref={scrollRef}
                    className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-sm"
                  >
                      {liveTranscripts.length === 0 && (
                          <div className="text-gray-600 italic text-center mt-4">Waiting for audio...</div>
                      )}
                      {liveTranscripts.map((t, i) => (
                          <div key={i} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                              <div className={`max-w-[85%] rounded px-3 py-2 ${
                                  t.role === 'user' ? 'bg-blue-900/20 text-blue-300' : 'text-gray-300'
                              }`}>
                                  <span className="text-[10px] opacity-40 block mb-1 uppercase">{t.role}</span>
                                  {t.text}
                              </div>
                          </div>
                      ))}
                  </div>
              </div>

              {/* Controls */}
              <div className="flex flex-col items-center gap-2 mb-4">
                <button
                  onClick={handleDisconnect}
                  className="group relative inline-flex items-center justify-center p-0.5 overflow-hidden text-sm font-medium rounded-full group-hover:from-red-600 group-hover:to-red-600 hover:text-white focus:ring-4 focus:outline-none focus:ring-red-800"
                >
                  <span className="relative px-12 py-3 transition-all ease-in duration-75 bg-gray-900 rounded-full group-hover:bg-red-600/20 border border-red-600 text-red-500 group-hover:text-white">
                    TERMINATE
                  </span>
                </button>
              </div>
            </div>
          )}

          {view === View.HISTORY && (
            <div className="absolute inset-0 z-50 bg-gray-900">
               <HistoryLog
                 history={history}
                 onBack={() => setView(View.SETUP)}
                 onClear={() => setHistory([])}
               />
            </div>
          )}

          {view === View.OBSERVATORY && (
            <div className="absolute inset-0 z-50 bg-gray-900 overflow-auto">
               <Observatory
                 onBack={() => setView(View.SETUP)}
                 paiApiUrl={PAI_API_URL}
                 paiToken={PAI_API_TOKEN}
               />
            </div>
          )}

        </main>
      </div>
    </div>
  );
}