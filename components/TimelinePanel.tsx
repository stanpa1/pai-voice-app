import React, { useState, useEffect, useMemo } from 'react';

interface TimelinePanelProps {
  onBack: () => void;
  paiApiUrl: string;
  paiToken: string;
}

interface TimelineEvent {
  ts: string;
  source: 'wiki' | 'notion' | 'sessions';
  topic: string;
  title: string;
  summary: string;
  meta?: {
    articles?: string[];
    created?: string[];
    kind?: string;
    notion_url?: string;
    source_url?: string;
    tags?: string[];
    session_id?: string;
    n_prompts?: number;
  };
}

interface TimelineTopic {
  source: string;
  topic: string;
  count: number;
}

interface TimelineData {
  days: number;
  count: number;
  topics: TimelineTopic[];
  events: TimelineEvent[];
}

const SOURCE_STYLES: Record<string, { label: string; badge: string; dot: string }> = {
  wiki: { label: 'Wiki', badge: 'bg-emerald-900/60 text-emerald-300 border-emerald-700/50', dot: 'bg-emerald-400' },
  notion: { label: 'Notion', badge: 'bg-amber-900/60 text-amber-300 border-amber-700/50', dot: 'bg-amber-400' },
  sessions: { label: 'Claude Code', badge: 'bg-blue-900/60 text-blue-300 border-blue-700/50', dot: 'bg-blue-400' },
};

const DAY_OPTIONS = [7, 30, 90];

export function TimelinePanel({ onBack, paiApiUrl, paiToken }: TimelinePanelProps) {
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [activeSources, setActiveSources] = useState<Set<string>>(new Set(['wiki', 'notion', 'sessions']));
  const [activeTopic, setActiveTopic] = useState<string | null>(null);

  const headers = { Authorization: `Bearer ${paiToken}` };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${paiApiUrl}/timeline?days=${days}`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError('Failed to load timeline');
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [days]);

  const toggleSource = (s: string) => {
    setActiveTopic(null);
    setActiveSources(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next.size === 0 ? new Set(['wiki', 'notion', 'sessions']) : next;
    });
  };

  const visibleEvents = useMemo(() => {
    if (!data) return [];
    return data.events.filter(e =>
      activeSources.has(e.source) && (!activeTopic || e.topic === activeTopic)
    );
  }, [data, activeSources, activeTopic]);

  const visibleTopics = useMemo(() => {
    if (!data) return [];
    const merged = new Map<string, number>();
    for (const t of data.topics) {
      if (!activeSources.has(t.source)) continue;
      merged.set(t.topic, (merged.get(t.topic) || 0) + t.count);
    }
    return [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
  }, [data, activeSources]);

  // Group events by calendar day
  const grouped = useMemo(() => {
    const groups: { day: string; label: string; events: TimelineEvent[] }[] = [];
    for (const e of visibleEvents) {
      const d = new Date(e.ts);
      const day = d.toISOString().slice(0, 10);
      let g = groups[groups.length - 1];
      if (!g || g.day !== day) {
        g = {
          day,
          label: d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }),
          events: [],
        };
        groups.push(g);
      }
      g.events.push(e);
    }
    return groups;
  }, [visibleEvents]);

  return (
    <div className="flex flex-col h-full text-gray-200">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur border-b border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-gray-400 hover:text-white" title="Back">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <h2 className="text-lg font-semibold">Timeline</h2>
            {data && <span className="text-xs text-gray-500">{visibleEvents.length} events</span>}
          </div>
          <div className="flex items-center gap-1">
            {DAY_OPTIONS.map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-2 py-1 text-xs rounded-md border ${days === d
                  ? 'bg-blue-900/60 border-blue-700 text-blue-200'
                  : 'border-gray-700 text-gray-400 hover:text-gray-200'}`}
              >
                {d}d
              </button>
            ))}
            <button onClick={fetchData} className="ml-2 text-gray-400 hover:text-white" title="Refresh">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </button>
          </div>
        </div>

        {/* Source filters */}
        <div className="flex items-center gap-2 mb-2">
          {Object.entries(SOURCE_STYLES).map(([key, s]) => (
            <button
              key={key}
              onClick={() => toggleSource(key)}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-colors ${activeSources.has(key) ? s.badge : 'border-gray-700 text-gray-500'}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${activeSources.has(key) ? s.dot : 'bg-gray-600'}`}></span>
              {s.label}
            </button>
          ))}
        </div>

        {/* Topic filters */}
        {visibleTopics.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mb-1">
            {visibleTopics.map(([topic, count]) => (
              <button
                key={topic}
                onClick={() => setActiveTopic(activeTopic === topic ? null : topic)}
                className={`whitespace-nowrap px-2 py-0.5 text-[11px] rounded-full border ${activeTopic === topic
                  ? 'bg-purple-900/60 border-purple-600 text-purple-200'
                  : 'border-gray-700/70 text-gray-400 hover:text-gray-200'}`}
              >
                {topic} <span className="opacity-60">{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading && <p className="text-gray-500 text-sm animate-pulse">Loading timeline…</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {!loading && !error && grouped.length === 0 && (
          <p className="text-gray-500 text-sm">No events in this range.</p>
        )}

        {grouped.map(group => (
          <div key={group.day} className="mb-6">
            <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2 sticky top-0">{group.label}</h3>
            <div className="border-l border-gray-800 ml-1.5 pl-4 space-y-3">
              {group.events.map((e, i) => {
                const s = SOURCE_STYLES[e.source];
                return (
                  <div key={`${group.day}-${i}`} className="relative">
                    <span className={`absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full ${s.dot}`}></span>
                    <div className="bg-gray-800/40 border border-gray-800 rounded-lg p-3">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`px-1.5 py-0.5 text-[10px] rounded border ${s.badge}`}>{s.label}</span>
                        <button
                          onClick={() => setActiveTopic(activeTopic === e.topic ? null : e.topic)}
                          className="px-1.5 py-0.5 text-[10px] rounded border border-gray-700 text-gray-400 hover:text-gray-200"
                        >
                          {e.topic}
                        </button>
                        {e.meta?.kind === 'new article' && (
                          <span className="px-1.5 py-0.5 text-[10px] rounded border border-purple-700/50 bg-purple-900/40 text-purple-300">new article</span>
                        )}
                        <span className="text-[10px] text-gray-500 ml-auto">
                          {new Date(e.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-gray-100">
                        {e.meta?.notion_url ? (
                          <a href={e.meta.notion_url} target="_blank" rel="noreferrer" className="hover:text-amber-300 underline decoration-gray-600">
                            {e.title}
                          </a>
                        ) : e.title}
                      </p>
                      {e.summary && <p className="text-xs text-gray-400 mt-1 leading-relaxed">{e.summary}</p>}
                      {e.source === 'sessions' && e.meta?.n_prompts != null && (
                        <p className="text-[10px] text-gray-500 mt-1">{e.meta.n_prompts} prompts</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
