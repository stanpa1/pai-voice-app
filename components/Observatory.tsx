import React, { useState, useEffect } from 'react';
import { ObservatoryEvent, ObservatoryStatus } from '../types';

interface ObservatoryProps {
  onBack: () => void;
  paiApiUrl: string;
  paiToken: string;
}

type TabType = 'all' | 'inbox' | 'voice' | 'links' | 'research';

interface AIStatus {
  backend: string;
  claude_sdk: { status: string; model: string | null; latency_ms: number | null; error: string | null };
  deepseek: { status: string };
  timestamp: string;
}

export function Observatory({ onBack, paiApiUrl, paiToken }: ObservatoryProps) {
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [status, setStatus] = useState<ObservatoryStatus | null>(null);
  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null);
  const [aiStatusLoading, setAiStatusLoading] = useState(false);
  const [events, setEvents] = useState<ObservatoryEvent[]>([]);
  const [voiceSessions, setVoiceSessions] = useState<ObservatoryEvent[]>([]);
  const [linkEnrichments, setLinkEnrichments] = useState<ObservatoryEvent[]>([]);
  const [researchJobs, setResearchJobs] = useState<ObservatoryEvent[]>([]);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const headers = {
    'Authorization': `Bearer ${paiToken}`,
    'Content-Type': 'application/json'
  };

  const fetchData = async () => {
    try {
      setError(null);
      const [statusRes, eventsRes, voiceRes, linksRes, researchRes] = await Promise.all([
        fetch(`${paiApiUrl}/observatory/status`, { headers }),
        fetch(`${paiApiUrl}/observatory/events?limit=50`, { headers }),
        fetch(`${paiApiUrl}/observatory/voice-sessions?limit=20`, { headers }),
        fetch(`${paiApiUrl}/observatory/link-enrichment?limit=20`, { headers }),
        fetch(`${paiApiUrl}/observatory/research?limit=20`, { headers })
      ]);

      if (statusRes.ok) setStatus(await statusRes.json());
      if (eventsRes.ok) {
        const data = await eventsRes.json();
        setEvents(data.events || []);
      }
      if (voiceRes.ok) {
        const data = await voiceRes.json();
        setVoiceSessions(data.sessions || []);
      }
      if (linksRes.ok) {
        const data = await linksRes.json();
        setLinkEnrichments(data.enrichments || []);
      }
      if (researchRes.ok) {
        const data = await researchRes.json();
        setResearchJobs(data.jobs || []);
      }
    } catch (e) {
      setError('Failed to fetch observatory data');
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchAiStatus = async () => {
    setAiStatusLoading(true);
    try {
      const res = await fetch(`${paiApiUrl}/observatory/ai-status`, { headers });
      if (res.ok) setAiStatus(await res.json());
    } catch (e) {
      console.error('Failed to fetch AI status:', e);
    } finally {
      setAiStatusLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    fetchAiStatus();
    const interval = setInterval(fetchData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const formatTime = (timestamp: string) => {
    if (!timestamp) return '';
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      if (isToday) {
        return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
      }
      return date.toLocaleDateString('pl-PL', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return timestamp;
    }
  };

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'inbox_voice': return '🎤';
      case 'inbox_photo': return '📷';
      case 'inbox_text': return '💬';
      case 'inbox_document': return '📄';
      case 'voice_session': return '🗣️';
      case 'link_enrichment': return '🔗';
      case 'research_brief': return '📚';
      default: return '📌';
    }
  };

  const getPlatformIcon = (platform?: string) => {
    switch (platform) {
      case 'x': return '𝕏';
      case 'reddit': return '🔴';
      default: return '🌐';
    }
  };

  const getStatusBadge = (eventStatus: string) => {
    const colors: Record<string, string> = {
      done: 'bg-green-500/20 text-green-400',
      delivered: 'bg-blue-500/20 text-blue-400',
      pending: 'bg-yellow-500/20 text-yellow-400',
      processing: 'bg-indigo-500/20 text-indigo-400',
      failed: 'bg-red-500/20 text-red-400'
    };
    return colors[eventStatus] || 'bg-gray-500/20 text-gray-400';
  };

  const getAllEvents = (): ObservatoryEvent[] => {
    const all = [
      ...events,
      ...voiceSessions,
      ...linkEnrichments.map(e => ({ ...e, timestamp: e.processed_at || '' })),
      ...researchJobs.map(e => ({ ...e, timestamp: e.requested_at || '' }))
    ];
    return all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  };

  const getFilteredEvents = (): ObservatoryEvent[] => {
    switch (activeTab) {
      case 'inbox': return events;
      case 'voice': return voiceSessions;
      case 'links': return linkEnrichments;
      case 'research': return researchJobs;
      default: return getAllEvents();
    }
  };

  const renderEvent = (event: ObservatoryEvent) => {
    const isVoiceSession = event.type === 'voice_session';
    const isExpanded = expandedSession === event.id;

    return (
      <div key={event.id} className="bg-gray-800 rounded-lg p-4 mb-3 border border-gray-700">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3 flex-1">
            <span className="text-xl">{getEventIcon(event.type)}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-gray-400 text-sm">{formatTime(event.timestamp)}</span>
                {event.platform && <span className="text-sm">{getPlatformIcon(event.platform)}</span>}
                <span className={`text-xs px-2 py-0.5 rounded ${getStatusBadge(event.status)}`}>
                  {event.status}
                </span>
              </div>

              {/* Inbox Voice */}
              {event.type === 'inbox_voice' && (
                <>
                  <p className="text-gray-200 text-sm">
                    Voice message {event.duration_sec ? `(${event.duration_sec}s)` : ''}
                  </p>
                  {event.transcription && (
                    <p className="text-gray-400 text-sm mt-1 italic">"{event.transcription}"</p>
                  )}
                </>
              )}

              {/* Inbox Photo */}
              {event.type === 'inbox_photo' && (
                <>
                  <p className="text-gray-200 text-sm">{event.caption || 'Photo'}</p>
                  {event.description && (
                    <p className="text-gray-400 text-sm mt-1">{event.description}</p>
                  )}
                  {event.ocr_text && (
                    <p className="text-gray-500 text-xs mt-1">OCR: {event.ocr_text.slice(0, 100)}...</p>
                  )}
                </>
              )}

              {/* Inbox Text */}
              {event.type === 'inbox_text' && (
                <p className="text-gray-200 text-sm">{event.content || 'Text message'}</p>
              )}

              {/* Voice Session */}
              {isVoiceSession && (
                <>
                  <div className="flex items-center gap-2">
                    <p className="text-gray-200 text-sm">
                      Voice Session ({Math.floor((event.duration_sec || 0) / 60)}m {(event.duration_sec || 0) % 60}s)
                    </p>
                    <span className="text-gray-500 text-xs">{event.transcript_count} turns</span>
                    <button
                      onClick={() => setExpandedSession(isExpanded ? null : event.id)}
                      className="text-indigo-400 text-xs hover:text-indigo-300"
                    >
                      {isExpanded ? '▲ Collapse' : '▼ Expand'}
                    </button>
                  </div>
                  {event.tools_used && event.tools_used.length > 0 && (
                    <p className="text-gray-500 text-xs mt-1">Tools: {event.tools_used.join(', ')}</p>
                  )}
                  {isExpanded && event.transcripts && (
                    <div className="mt-3 bg-gray-900 rounded p-3 max-h-64 overflow-y-auto">
                      {event.transcripts.map((t, i) => (
                        <div key={i} className={`mb-2 ${t.role === 'user' ? 'text-blue-300' : 'text-green-300'}`}>
                          <span className="text-xs text-gray-500">{t.role === 'user' ? '👤' : '🤖'}</span>
                          <span className="ml-2 text-sm">{t.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Link Enrichment */}
              {event.type === 'link_enrichment' && (
                <>
                  <p className="text-gray-200 text-sm">{event.notion_page_title || 'Link'}</p>
                  {event.url && (
                    <a
                      href={event.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-400 text-xs hover:underline break-all"
                    >
                      {event.url.length > 60 ? event.url.slice(0, 60) + '...' : event.url}
                    </a>
                  )}
                </>
              )}

              {/* Research Brief */}
              {event.type === 'research_brief' && (
                <>
                  <p className="text-gray-200 text-sm">{event.topic || 'Research'}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-gray-500 text-xs">Model: {event.model}</span>
                    {event.cost_estimate && (
                      <span className="text-gray-500 text-xs">({event.cost_estimate})</span>
                    )}
                  </div>
                  {event.delivered_at && (
                    <p className="text-green-400 text-xs mt-1">Delivered: {formatTime(event.delivered_at)}</p>
                  )}
                </>
              )}

              {/* AI Response */}
              {event.ai_triggered && event.ai_response_preview && (
                <div className="mt-2 p-2 bg-indigo-500/10 rounded border border-indigo-500/20">
                  <span className="text-indigo-400 text-xs">🤖 PAI:</span>
                  <p className="text-gray-300 text-sm mt-1">{event.ai_response_preview}</p>
                </div>
              )}

              {/* Error */}
              {event.error && (
                <p className="text-red-400 text-xs mt-1">Error: {event.error}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400">Loading observatory...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 p-4">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <button onClick={onBack} className="text-gray-400 hover:text-white">
            ← Back
          </button>
          <h1 className="text-xl font-semibold">PAI Observatory</h1>
          <button onClick={fetchData} className="text-gray-400 hover:text-white text-sm">
            ↻ Refresh
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4">
        {/* Status Bar */}
        {status && (
          <div className="flex flex-wrap gap-2 mb-4">
            {Object.entries(status.services).map(([name, svc]) => (
              <div
                key={name}
                className={`px-3 py-1 rounded-full text-xs flex items-center gap-1 ${
                  svc.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${svc.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`} />
                {name}
                {svc.uptime && <span className="text-gray-500 ml-1">({svc.uptime})</span>}
              </div>
            ))}
            <div className="px-3 py-1 rounded-full text-xs bg-gray-700 text-gray-300">
              Queue: {status.queue.pending} pending
            </div>
          </div>
        )}

        {/* AI Backend Indicator */}
        <div className="bg-gray-800 rounded-lg p-3 mb-4 border border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500 font-medium">AI Backend</span>
              {aiStatusLoading ? (
                <span className="text-xs text-gray-500 animate-pulse">checking...</span>
              ) : aiStatus ? (
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${
                    aiStatus.backend === 'claude_sdk' ? 'bg-green-500' :
                    aiStatus.backend === 'deepseek' ? 'bg-yellow-500' : 'bg-red-500'
                  }`} />
                  <span className={`text-sm font-semibold ${
                    aiStatus.backend === 'claude_sdk' ? 'text-green-400' :
                    aiStatus.backend === 'deepseek' ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {aiStatus.backend === 'claude_sdk' ? 'Claude SDK' :
                     aiStatus.backend === 'deepseek' ? 'DeepSeek (fallback)' : 'Offline'}
                  </span>
                  {aiStatus.claude_sdk.latency_ms && (
                    <span className="text-xs text-gray-500">{aiStatus.claude_sdk.latency_ms}ms</span>
                  )}
                  {aiStatus.backend === 'deepseek' && aiStatus.claude_sdk.error && (
                    <span className="text-xs text-red-400 ml-1" title={aiStatus.claude_sdk.error}>
                      Claude: {aiStatus.claude_sdk.error.slice(0, 60)}...
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-xs text-gray-500">unavailable</span>
              )}
            </div>
            <button
              onClick={fetchAiStatus}
              disabled={aiStatusLoading}
              className="text-gray-500 hover:text-gray-300 text-xs disabled:opacity-50"
            >
              {aiStatusLoading ? '...' : '↻ Check'}
            </button>
          </div>
          {aiStatus && aiStatus.backend === 'claude_sdk' && (
            <div className="mt-1 text-xs text-gray-500">
              OAuth (Max) &middot; DeepSeek fallback: {aiStatus.deepseek.status}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/20 text-red-400 p-3 rounded mb-4">{error}</div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 overflow-x-auto">
          {(['all', 'inbox', 'voice', 'links', 'research'] as TabType[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm whitespace-nowrap ${
                activeTab === tab
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {tab === 'all' && 'All'}
              {tab === 'inbox' && `Inbox (${events.length})`}
              {tab === 'voice' && `Voice (${voiceSessions.length})`}
              {tab === 'links' && `Links (${linkEnrichments.length})`}
              {tab === 'research' && `Research (${researchJobs.length})`}
            </button>
          ))}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          <div className="bg-gray-800 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-blue-400">{events.length}</div>
            <div className="text-xs text-gray-500">Inbox</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-green-400">{voiceSessions.length}</div>
            <div className="text-xs text-gray-500">Voice</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-purple-400">{linkEnrichments.length}</div>
            <div className="text-xs text-gray-500">Links</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-yellow-400">{researchJobs.length}</div>
            <div className="text-xs text-gray-500">Research</div>
          </div>
        </div>

        {/* Event Feed */}
        <div className="space-y-1">
          {getFilteredEvents().length === 0 ? (
            <div className="text-gray-500 text-center py-8">No events found</div>
          ) : (
            getFilteredEvents().map(renderEvent)
          )}
        </div>
      </div>
    </div>
  );
}

export default Observatory;
