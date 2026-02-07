import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { decodeBase64, float32ToPCM16, pcm16ToAudioBuffer } from '../utils/audioUtils';
import { SystemConfig } from '../types';

// PAI API Configuration
const PAI_API_URL = import.meta.env.VITE_PAI_API_URL || 'https://api.stankowski.io/api';
const PAI_API_TOKEN = import.meta.env.VITE_PAI_API_TOKEN || '';

// Tool Definitions - PAI Integration
const systemTools: FunctionDeclaration[] = [
  {
    name: 'searchPAI',
    description: 'Search PAI memory for information about past notes, projects, books, conversations, or anything not in current context. Use this when user asks about something you don\'t have information about.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Search query - what to look for in PAI memory'
        },
        category: {
          type: Type.STRING,
          description: 'Category to search in: projects, notes, inbox, or all'
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'getPAIContext',
    description: 'Get current PAI context including active projects, recent notes, and today\'s date. Use at the start of conversation or when user asks about current status.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'addPAINote',
    description: 'Save a note to PAI memory. Use when user wants to remember something, save an idea, or create a reminder.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        content: {
          type: Type.STRING,
          description: 'The note content to save'
        },
        tags: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Tags for categorization (e.g., reminder, idea, task)'
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'queryNotion',
    description: 'Query Notion databases for books, saves, or projects. Use when user asks about their reading list, saved items, or project details in Notion.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        database: {
          type: Type.STRING,
          description: 'Which database: books, saves, or projects'
        },
        filter: {
          type: Type.STRING,
          description: 'Optional filter like status:reading or tag:AI'
        },
      },
      required: ['database'],
    },
  },
  {
    name: 'getProjects',
    description: 'Get list of projects from Notion. Use when user asks about their projects, what they are working on, or project status.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        status: {
          type: Type.STRING,
          description: 'Filter by status: active, done, planned, paused. Default is active.'
        },
      },
    },
  },
  {
    name: 'updateProject',
    description: 'Update a project in Notion. Use when user says a project is done, wants to change next action, or set a deadline. Supports natural language deadlines like "friday", "za tydzień", "15 lutego".',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description: 'Project name or partial name to match'
        },
        status: {
          type: Type.STRING,
          description: 'New status: done/zrobione, active, planned, paused'
        },
        next_action: {
          type: Type.STRING,
          description: 'New next action for the project'
        },
        deadline: {
          type: Type.STRING,
          description: 'Deadline - can be natural language like "friday", "jutro", "za tydzień", "15 lutego"'
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'addProject',
    description: 'Create a new project in Notion. Use when user wants to add a new project or task to track.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description: 'Project name'
        },
        area: {
          type: Type.STRING,
          description: 'Area: home/dom, work/praca, health/zdrowie, finance/finanse, growth/rozwój'
        },
        priority: {
          type: Type.STRING,
          description: 'Priority: high/wysoki, medium/średni, low/niski'
        },
        next_action: {
          type: Type.STRING,
          description: 'First next action'
        },
        deadline: {
          type: Type.STRING,
          description: 'Deadline - can be natural language'
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'weeklyReview',
    description: 'Get weekly review data - summary of projects, what was completed this week, upcoming deadlines, and reflection questions. Use when user wants to do a weekly review or asks about their week.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'searchNotes',
    description: 'Search the Note List database in Notion. Use when user asks about their notes, articles, saved content, bookmarks, or reading list. Returns notes with title, type, status, author, and link.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Search query - text to find in note titles or content'
        },
        type: {
          type: Type.STRING,
          description: 'Filter by type: Article, Book, Task, Link, etc.'
        },
        status: {
          type: Type.STRING,
          description: 'Filter by status'
        },
        area: {
          type: Type.STRING,
          description: 'Filter by area: Work or Private'
        },
      },
    },
  },
  {
    name: 'searchBooks',
    description: 'Search the Books Tracker database in Notion. Use when user asks about books they read, are reading, or want to read. Returns books with title, author, status, rating.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Search query - book title or author name'
        },
        status: {
          type: Type.STRING,
          description: 'Filter by status: Completed, Reading, To Read'
        },
        author: {
          type: Type.STRING,
          description: 'Filter by author name'
        },
      },
    },
  },
  {
    name: 'getCurrentlyReading',
    description: 'Get list of books user is currently reading. Use when user asks "what am I reading?", "co czytam?", or similar questions about current books.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'getReadingList',
    description: 'Get list of books on the reading list (To Read status). Use when user asks about their reading list, what to read next, or books they want to read.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
];

// Helper function to call PAI API
async function callPAIApi(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
  try {
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PAI_API_TOKEN}`,
      },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    console.log(`Calling PAI API: ${PAI_API_URL}${endpoint}`);
    const response = await fetch(`${PAI_API_URL}${endpoint}`, options);

    if (!response.ok) {
      throw new Error(`PAI API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('PAI API call failed:', error);
    return { error: String(error) };
  }
}

interface LiveClientCallbacks {
  onOpen: () => void;
  onClose: () => void;
  onError: (error: Error) => void;
  onAudioData: (amplitude: number) => void; // For visualization
  onTranscript: (role: 'user' | 'model', text: string) => void;
}

export class LiveClient {
  private ai: GoogleGenAI;
  private config: SystemConfig;
  private callbacks: LiveClientCallbacks;
  
  private inputContext: AudioContext | null = null;
  private outputContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  
  private nextStartTime: number = 0;
  private audioSources: Set<AudioBufferSourceNode> = new Set();
  
  private activeSession: any = null;
  private isConnected: boolean = false;

  constructor(apiKey: string, config: SystemConfig, callbacks: LiveClientCallbacks) {
    this.ai = new GoogleGenAI({ apiKey });
    this.config = config;
    this.callbacks = callbacks;
  }

  public async connect() {
    try {
      // 1. Setup Audio Input (Mic)
      this.inputContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      if (this.inputContext.state === 'suspended') {
        await this.inputContext.resume();
      }
      
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // 2. Setup Audio Output (Speaker)
      this.outputContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      if (this.outputContext.state === 'suspended') {
        await this.outputContext.resume();
      }

      // 3. Connect to Gemini Live
      const sessionPromise = this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: this.config.voiceName } },
          },
          systemInstruction: this.config.systemInstruction,
          tools: this.config.useTools ? [{ functionDeclarations: systemTools }] : undefined,
          inputAudioTranscription: {}, // Just enable it, do not pass model
          outputAudioTranscription: {}, // Just enable it, do not pass model
        },
        callbacks: {
          onopen: () => {
            this.isConnected = true;
            this.callbacks.onOpen();
            this.startAudioInputStreaming(sessionPromise);
          },
          onmessage: (msg: LiveServerMessage) => this.handleMessage(msg, sessionPromise),
          onclose: () => {
            this.isConnected = false;
            this.callbacks.onClose();
          },
          onerror: (err: any) => {
             console.error("Gemini Live API Error:", err);
             const errorMessage = err.message || err.toString() || "Unknown Session Error";
             this.callbacks.onError(new Error(errorMessage));
          }
        },
      });

      this.activeSession = sessionPromise;
      await sessionPromise;

    } catch (err) {
      console.error("Connection failed:", err);
      this.callbacks.onError(err instanceof Error ? err : new Error('Failed to connect: ' + err));
    }
  }

  private startAudioInputStreaming(sessionPromise: Promise<any>) {
    if (!this.inputContext || !this.mediaStream) return;

    this.sourceNode = this.inputContext.createMediaStreamSource(this.mediaStream);
    this.processor = this.inputContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (!this.isConnected) return;
      
      const inputData = e.inputBuffer.getChannelData(0);
      
      // Calculate volume for visualizer
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        sum += inputData[i] * inputData[i];
      }
      const rms = Math.sqrt(sum / inputData.length);
      this.callbacks.onAudioData(rms);

      // Convert and send
      const pcmData = float32ToPCM16(inputData);
      
      sessionPromise.then(session => {
        if (this.isConnected) {
            session.sendRealtimeInput({ media: pcmData });
        }
      }).catch(err => {
          console.error("Error sending input:", err);
      });
    };

    this.sourceNode.connect(this.processor);
    this.processor.connect(this.inputContext.destination);
  }

  private async handleMessage(message: LiveServerMessage, sessionPromise: Promise<any>) {
    try {
        // 1. Handle Audio Output
        const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
        if (audioData && this.outputContext) {
          const rawBytes = decodeBase64(audioData);
          const audioBuffer = await pcm16ToAudioBuffer(rawBytes, this.outputContext);
          
          this.playAudioBuffer(audioBuffer);
        }

        // 2. Handle Interruption
        if (message.serverContent?.interrupted) {
          this.stopAllAudio();
        }

        // 3. Handle Transcripts
        if (message.serverContent?.outputTranscription?.text) {
             this.callbacks.onTranscript('model', message.serverContent.outputTranscription.text);
        }
        if (message.serverContent?.inputTranscription?.text) {
            this.callbacks.onTranscript('user', message.serverContent.inputTranscription.text);
        }

        // 4. Handle Tool Calls - PAI Integration
        if (message.toolCall) {
            for (const fc of message.toolCall.functionCalls) {
                console.log("Executing PAI Tool:", fc.name, fc.args);
                let result: any = { error: "Unknown tool" };

                try {
                    if (fc.name === 'searchPAI') {
                        const args = fc.args as { query: string; category?: string };
                        result = await callPAIApi('/search', 'POST', {
                            query: args.query,
                            category: args.category || 'all',
                            limit: 5
                        });
                    } else if (fc.name === 'getPAIContext') {
                        result = await callPAIApi('/context', 'GET');
                    } else if (fc.name === 'addPAINote') {
                        const args = fc.args as { content: string; tags?: string[] };
                        result = await callPAIApi('/notes', 'POST', {
                            content: args.content,
                            tags: args.tags || [],
                            source: 'nexus-voice'
                        });
                    } else if (fc.name === 'queryNotion') {
                        const args = fc.args as { database: string; filter?: string };
                        result = await callPAIApi(`/notion/${args.database}`, 'POST', {
                            filter: args.filter
                        });
                    } else if (fc.name === 'getProjects') {
                        const args = fc.args as { status?: string };
                        const queryParams = args.status ? `?status=${args.status}` : '';
                        result = await callPAIApi(`/projects${queryParams}`, 'GET');
                    } else if (fc.name === 'updateProject') {
                        const args = fc.args as { name: string; status?: string; next_action?: string; deadline?: string };
                        result = await callPAIApi('/projects', 'PATCH', {
                            name: args.name,
                            status: args.status,
                            next_action: args.next_action,
                            deadline: args.deadline
                        });
                    } else if (fc.name === 'addProject') {
                        const args = fc.args as { name: string; area?: string; priority?: string; next_action?: string; deadline?: string };
                        result = await callPAIApi('/projects', 'POST', {
                            name: args.name,
                            area: args.area,
                            priority: args.priority,
                            next_action: args.next_action,
                            deadline: args.deadline
                        });
                    } else if (fc.name === 'weeklyReview') {
                        result = await callPAIApi('/weekly-review', 'GET');
                    } else if (fc.name === 'searchNotes') {
                        const args = fc.args as { query?: string; type?: string; status?: string; area?: string };
                        const params = new URLSearchParams();
                        if (args.query) params.append('q', args.query);
                        if (args.type) params.append('type', args.type);
                        if (args.status) params.append('status', args.status);
                        if (args.area) params.append('area', args.area);
                        const queryStr = params.toString();
                        result = await callPAIApi(`/note-list/search?${queryStr}`, 'GET');
                    } else if (fc.name === 'searchBooks') {
                        const args = fc.args as { query?: string; status?: string; author?: string };
                        const params = new URLSearchParams();
                        if (args.query) params.append('q', args.query);
                        if (args.status) params.append('status', args.status);
                        if (args.author) params.append('author', args.author);
                        const queryStr = params.toString();
                        result = await callPAIApi(`/books/search?${queryStr}`, 'GET');
                    } else if (fc.name === 'getCurrentlyReading') {
                        result = await callPAIApi('/books/reading', 'GET');
                    } else if (fc.name === 'getReadingList') {
                        result = await callPAIApi('/books/to-read', 'GET');
                    }
                } catch (error) {
                    console.error('Tool execution error:', error);
                    result = { error: String(error) };
                }

                console.log("Tool result:", result);

                sessionPromise.then(session => {
                    session.sendToolResponse({
                        functionResponses: {
                            id: fc.id,
                            name: fc.name,
                            response: { result }
                        }
                    });
                });
            }
        }
    } catch(e) {
        console.error("Error processing message:", e);
    }
  }

  private playAudioBuffer(buffer: AudioBuffer) {
    if (!this.outputContext) return;

    // Ensure we schedule seamlessly
    const currentTime = this.outputContext.currentTime;
    if (this.nextStartTime < currentTime) {
      this.nextStartTime = currentTime;
    }

    const source = this.outputContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.outputContext.destination);
    source.start(this.nextStartTime);
    
    this.nextStartTime += buffer.duration;
    this.audioSources.add(source);
    
    source.onended = () => {
      this.audioSources.delete(source);
    };
  }

  private stopAllAudio() {
    this.audioSources.forEach(source => {
      try { source.stop(); } catch(e) {}
    });
    this.audioSources.clear();
    
    if (this.outputContext) {
      this.nextStartTime = this.outputContext.currentTime;
    }
  }

  public async disconnect() {
    this.isConnected = false;
    
    // Stop input processing
    if (this.processor) {
        this.processor.disconnect();
        this.processor = null;
    }
    if (this.sourceNode) {
        this.sourceNode.disconnect();
        this.sourceNode = null;
    }
    if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(t => t.stop());
        this.mediaStream = null;
    }
    if (this.inputContext) {
        await this.inputContext.close();
        this.inputContext = null;
    }

    // Stop output
    this.stopAllAudio();
    if (this.outputContext) {
        await this.outputContext.close();
        this.outputContext = null;
    }

    if (this.activeSession) {
        this.activeSession.then((session: any) => {
            if (session.close) session.close();
        });
    }
  }
}