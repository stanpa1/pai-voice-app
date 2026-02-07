export enum View {
  SETUP = 'SETUP',
  ACTIVE_CALL = 'ACTIVE_CALL',
  HISTORY = 'HISTORY',
  OBSERVATORY = 'OBSERVATORY',
}

// Observatory types
export type EventType = 'inbox_voice' | 'inbox_photo' | 'inbox_text' | 'inbox_document' | 'voice_session' | 'link_enrichment' | 'research_brief';
export type EventStatus = 'pending' | 'processing' | 'done' | 'failed' | 'delivered';

export interface ObservatoryEvent {
  id: string;
  type: EventType;
  status: EventStatus;
  timestamp: string;
  processed_at?: string;
  error?: string;
  // Inbox specific
  duration_sec?: number;
  transcription?: string;
  caption?: string;
  description?: string;
  ocr_text?: string;
  content?: string;
  ai_triggered?: boolean;
  ai_response_preview?: string;
  // Voice session
  transcript_count?: number;
  transcripts?: { role: 'user' | 'model'; text: string }[];
  tools_used?: string[];
  // Link enrichment
  url?: string;
  platform?: 'x' | 'reddit' | 'generic';
  notion_page_title?: string;
  content_preview?: string;
  author?: string;
  // Research
  topic?: string;
  model?: 'deepseek' | 'opus';
  sources?: string[];
  requested_at?: string;
  processing_started?: string;
  completed_at?: string;
  delivered_at?: string;
  brief_path?: string;
  cost_estimate?: string;
}

export interface ServiceStatus {
  status: string;
  substate?: string;
  uptime?: string;
  error?: string;
}

export interface ObservatoryStatus {
  services: Record<string, ServiceStatus>;
  queue: {
    pending: number;
    processing: number;
    done: number;
    failed: number;
  };
}

export enum VoiceName {
  Puck = 'Puck',
  Charon = 'Charon',
  Kore = 'Kore',
  Fenrir = 'Fenrir',
  Zephyr = 'Zephyr',
}

export interface SystemConfig {
  systemInstruction: string;
  voiceName: VoiceName;
  useTools: boolean;
  webhookUrl: string; // New field for integration
}

export interface HistoryItem {
  id: string;
  timestamp: number;
  duration: number; // in seconds
  transcripts: { role: 'user' | 'model'; text: string }[];
}

export interface LiveConnectionState {
  isConnected: boolean;
  isAudioStreaming: boolean;
  error: string | null;
  volume: number; // For visualization 0-1
}