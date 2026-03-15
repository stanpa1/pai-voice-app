import React, { useState, useEffect } from 'react';

interface ActionsPanelProps {
  onBack: () => void;
  paiApiUrl: string;
  paiToken: string;
}

type SubTab = 'actions' | 'prompts';

interface ActionResult {
  actionId: string;
  content: string | null;
  loading: boolean;
  error: string | null;
}

interface Prompt {
  id: string;
  name: string;
  category: string;
  description: string;
  template: string;
  default_template?: string;
  is_modified: boolean;
}

export function ActionsPanel({ onBack, paiApiUrl, paiToken }: ActionsPanelProps) {
  const [activeTab, setActiveTab] = useState<SubTab>('actions');

  // Actions state
  const [results, setResults] = useState<Record<string, ActionResult>>({});
  const [researchTopic, setResearchTopic] = useState('');
  const [researchModel, setResearchModel] = useState('deepseek');
  const [podcastUrl, setPodcastUrl] = useState('');
  const [podcastFormat, setPodcastFormat] = useState('Deep Dive');
  const [paiQuery, setPaiQuery] = useState('');
  const [transcriptUrl, setTranscriptUrl] = useState('');
  const [bookQuery, setBookQuery] = useState('');
  const [researchPodcastTopic, setResearchPodcastTopic] = useState('');
  const [researchPodcastFormat, setResearchPodcastFormat] = useState('deep-dive');
  const [resetConfirm, setResetConfirm] = useState(false);

  // Prompts state
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [promptsLoading, setPromptsLoading] = useState(false);
  const [promptsError, setPromptsError] = useState<string | null>(null);
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [editedTemplates, setEditedTemplates] = useState<Record<string, string>>({});
  const [savingPrompt, setSavingPrompt] = useState<string | null>(null);
  const [showDefault, setShowDefault] = useState<string | null>(null);

  const headers = {
    'Authorization': `Bearer ${paiToken}`,
    'Content-Type': 'application/json'
  };

  // --- Actions logic ---

  const setActionResult = (actionId: string, update: Partial<ActionResult>) => {
    setResults(prev => ({
      ...prev,
      [actionId]: {
        actionId,
        content: prev[actionId]?.content || null,
        loading: prev[actionId]?.loading || false,
        error: prev[actionId]?.error || null,
        ...update
      }
    }));
  };

  const runAction = async (actionId: string, endpoint: string, body: Record<string, unknown> = {}) => {
    setActionResult(actionId, { loading: true, error: null, content: null });
    try {
      const res = await fetch(`${paiApiUrl}${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`${res.status}: ${errText}`);
      }
      const data = await res.json();
      const content = data.content || data.result || data.message || data.events || JSON.stringify(data, null, 2);
      const displayContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
      setActionResult(actionId, { loading: false, content: displayContent });
    } catch (e: any) {
      const msg = e.message || 'Request failed';
      // Long-running actions
      if (msg.includes('202') || msg.includes('queued') || msg.includes('accepted')) {
        setActionResult(actionId, { loading: false, content: 'Action queued. Results will be delivered via Telegram.' });
      } else {
        setActionResult(actionId, { loading: false, error: msg });
      }
    }
  };

  const renderResult = (actionId: string) => {
    const r = results[actionId];
    if (!r) return null;
    if (r.loading) {
      return (
        <div className="mt-3 p-3 bg-gray-900 rounded border border-gray-700">
          <span className="text-gray-400 text-sm animate-pulse">Processing...</span>
        </div>
      );
    }
    if (r.error) {
      return (
        <div className="mt-3 p-3 bg-red-500/10 rounded border border-red-500/20">
          <span className="text-red-400 text-sm">{r.error}</span>
        </div>
      );
    }
    if (r.content) {
      return (
        <div className="mt-3 p-3 bg-gray-900 rounded border border-gray-700 max-h-64 overflow-y-auto">
          <pre className="text-gray-300 text-sm whitespace-pre-wrap font-sans">{r.content}</pre>
        </div>
      );
    }
    return null;
  };

  // --- Prompts logic ---

  const fetchPrompts = async () => {
    setPromptsLoading(true);
    setPromptsError(null);
    try {
      const res = await fetch(`${paiApiUrl}/prompts`, { headers });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      const data = await res.json();
      const promptsObj = data.prompts || data || {};
      const promptsList = Object.entries(promptsObj).map(([id, p]: [string, any]) => ({
        id,
        name: p.name || id,
        category: p.category || 'unknown',
        description: p.description || '',
        template: p.template || '',
        default_template: p.default_template,
        is_modified: p.is_modified || false,
      }));
      setPrompts(promptsList);
    } catch (e: any) {
      setPromptsError(e.message || 'Failed to fetch prompts');
    } finally {
      setPromptsLoading(false);
    }
  };

  const savePrompt = async (id: string) => {
    const template = editedTemplates[id];
    if (!template) return;
    setSavingPrompt(id);
    try {
      const res = await fetch(`${paiApiUrl}/prompts/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ template })
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      setEditingPrompt(null);
      await fetchPrompts();
    } catch (e: any) {
      alert(`Failed to save: ${e.message}`);
    } finally {
      setSavingPrompt(null);
    }
  };

  const resetPrompt = async (id: string) => {
    if (!confirm('Reset this prompt to its default template?')) return;
    try {
      const res = await fetch(`${paiApiUrl}/prompts/${id}`, {
        method: 'DELETE',
        headers
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      setEditingPrompt(null);
      setEditedTemplates(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await fetchPrompts();
    } catch (e: any) {
      alert(`Failed to reset: ${e.message}`);
    }
  };

  useEffect(() => {
    if (activeTab === 'prompts' && prompts.length === 0) {
      fetchPrompts();
    }
  }, [activeTab]);

  // --- Render ---

  const actionCardClass = 'bg-gray-800 rounded-lg p-4 border border-gray-700';
  const btnClass = 'px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const btnSmClass = 'px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const inputClass = 'w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500';
  const selectClass = 'bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500';

  const renderActions = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Insight Now */}
      <div className={actionCardClass}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">💡</span>
          <div>
            <h3 className="text-gray-100 font-medium">Insight Now</h3>
            <p className="text-gray-500 text-xs">Generate a fresh insight from your notes</p>
          </div>
        </div>
        <button
          className={btnClass}
          disabled={results['insight']?.loading}
          onClick={() => runAction('insight', '/actions/insight')}
        >
          {results['insight']?.loading ? 'Generating...' : 'Generate Insight'}
        </button>
        {renderResult('insight')}
      </div>

      {/* Calendar */}
      <div className={actionCardClass}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">📅</span>
          <div>
            <h3 className="text-gray-100 font-medium">Calendar</h3>
            <p className="text-gray-500 text-xs">Check your upcoming events</p>
          </div>
        </div>
        <div className="flex gap-2">
          {['today', 'tomorrow', 'week'].map(period => (
            <button
              key={period}
              className={btnSmClass}
              disabled={results['calendar']?.loading}
              onClick={() => runAction('calendar', '/actions/calendar', { input: period })}
            >
              {period.charAt(0).toUpperCase() + period.slice(1)}
            </button>
          ))}
        </div>
        {renderResult('calendar')}
      </div>

      {/* Weekly Digest */}
      <div className={actionCardClass}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">📊</span>
          <div>
            <h3 className="text-gray-100 font-medium">Weekly Digest</h3>
            <p className="text-gray-500 text-xs">Generate your weekly summary</p>
          </div>
        </div>
        <button
          className={btnClass}
          disabled={results['digest']?.loading}
          onClick={() => runAction('digest', '/actions/digest')}
        >
          {results['digest']?.loading ? 'Generating...' : 'Generate Digest'}
        </button>
        {renderResult('digest')}
      </div>

      {/* Daily Brief */}
      <div className={actionCardClass}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">☀️</span>
          <div>
            <h3 className="text-gray-100 font-medium">Daily Brief</h3>
            <p className="text-gray-500 text-xs">Morning summary: calendar, projects, notes</p>
          </div>
        </div>
        <button
          className={btnClass}
          disabled={results['daily-brief']?.loading}
          onClick={() => runAction('daily-brief', '/actions/daily-brief')}
        >
          {results['daily-brief']?.loading ? 'Generating...' : 'Generate Brief'}
        </button>
        {renderResult('daily-brief')}
      </div>

      {/* Research Brief */}
      <div className={actionCardClass}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">📚</span>
          <div>
            <h3 className="text-gray-100 font-medium">Research Brief</h3>
            <p className="text-gray-500 text-xs">Deep research on any topic</p>
          </div>
        </div>
        <div className="space-y-2">
          <input
            type="text"
            className={inputClass}
            placeholder="Enter research topic..."
            value={researchTopic}
            onChange={e => setResearchTopic(e.target.value)}
          />
          <div className="flex gap-2">
            <select
              className={selectClass}
              value={researchModel}
              onChange={e => setResearchModel(e.target.value)}
            >
              <option value="deepseek">DeepSeek</option>
              <option value="opus">Opus</option>
            </select>
            <button
              className={btnClass}
              disabled={!researchTopic.trim() || results['research']?.loading}
              onClick={() => {
                runAction('research', '/actions/research', { input: researchTopic, model: researchModel });
              }}
            >
              {results['research']?.loading ? 'Submitting...' : 'Research'}
            </button>
          </div>
        </div>
        {renderResult('research')}
      </div>

      {/* Podcast */}
      <div className={actionCardClass}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">🎙️</span>
          <div>
            <h3 className="text-gray-100 font-medium">Podcast</h3>
            <p className="text-gray-500 text-xs">Generate from URL(s) — separate multiple with commas</p>
          </div>
        </div>
        <div className="space-y-2">
          <textarea
            className={inputClass + ' min-h-[60px] resize-y'}
            placeholder="Enter URL(s) separated by commas or newlines..."
            value={podcastUrl}
            onChange={e => setPodcastUrl(e.target.value)}
            rows={2}
          />
          <div className="flex gap-2">
            <select
              className={selectClass}
              value={podcastFormat}
              onChange={e => setPodcastFormat(e.target.value)}
            >
              <option value="deep-dive">Deep Dive</option>
              <option value="brief">Brief</option>
              <option value="critique">Critique</option>
              <option value="debate">Debate</option>
            </select>
            <button
              className={btnClass}
              disabled={!podcastUrl.trim() || results['podcast']?.loading}
              onClick={() => {
                runAction('podcast', '/actions/podcast', { input: podcastUrl, format: podcastFormat });
              }}
            >
              {results['podcast']?.loading ? 'Queuing...' : 'Generate'}
            </button>
          </div>
        </div>
        {renderResult('podcast')}
      </div>

      {/* Research Podcast */}
      <div className={actionCardClass}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">🔬</span>
          <div>
            <h3 className="text-gray-100 font-medium">Research Podcast</h3>
            <p className="text-gray-500 text-xs">Research a topic with AI, then generate a podcast</p>
          </div>
        </div>
        <div className="space-y-2">
          <input
            type="text"
            className={inputClass}
            placeholder="Enter topic to research..."
            value={researchPodcastTopic}
            onChange={e => setResearchPodcastTopic(e.target.value)}
          />
          <div className="flex gap-2">
            <select
              className={selectClass}
              value={researchPodcastFormat}
              onChange={e => setResearchPodcastFormat(e.target.value)}
            >
              <option value="deep-dive">Deep Dive</option>
              <option value="brief">Brief</option>
              <option value="critique">Critique</option>
              <option value="debate">Debate</option>
            </select>
            <button
              className={btnClass}
              disabled={!researchPodcastTopic.trim() || results['research-podcast']?.loading}
              onClick={() => {
                runAction('research-podcast', '/actions/research-podcast', { input: researchPodcastTopic, format: researchPodcastFormat });
              }}
            >
              {results['research-podcast']?.loading ? 'Researching...' : 'Research & Generate'}
            </button>
          </div>
        </div>
        {renderResult('research-podcast')}
      </div>

      {/* PAI Query */}
      <div className={actionCardClass}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">🤖</span>
          <div>
            <h3 className="text-gray-100 font-medium">PAI Query</h3>
            <p className="text-gray-500 text-xs">Ask PAI anything</p>
          </div>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            className={inputClass}
            placeholder="Ask a question..."
            value={paiQuery}
            onChange={e => setPaiQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && paiQuery.trim()) {
                runAction('pai-query', '/actions/pai-query', { input: paiQuery });
              }
            }}
          />
          <button
            className={btnClass}
            disabled={!paiQuery.trim() || results['pai-query']?.loading}
            onClick={() => runAction('pai-query', '/actions/pai-query', { input: paiQuery })}
          >
            {results['pai-query']?.loading ? '...' : 'Ask'}
          </button>
        </div>
        {renderResult('pai-query')}
      </div>

      {/* YouTube Transcript */}
      <div className={actionCardClass}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">📝</span>
          <div>
            <h3 className="text-gray-100 font-medium">YouTube Transcript</h3>
            <p className="text-gray-500 text-xs">Extract transcript from a YouTube video</p>
          </div>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            className={inputClass}
            placeholder="YouTube URL..."
            value={transcriptUrl}
            onChange={e => setTranscriptUrl(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && transcriptUrl.trim()) {
                runAction('transcript', '/actions/podcast', { input: `@pai transcript: ${transcriptUrl}` });
              }
            }}
          />
          <button
            className={btnClass}
            disabled={!transcriptUrl.trim() || results['transcript']?.loading}
            onClick={() => runAction('transcript', '/actions/podcast', { input: `@pai transcript: ${transcriptUrl}` })}
          >
            {results['transcript']?.loading ? '...' : 'Extract'}
          </button>
        </div>
        {renderResult('transcript')}
      </div>

      {/* Enrich X Links */}
      <div className={actionCardClass}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">𝕏</span>
          <div>
            <h3 className="text-gray-100 font-medium">Enrich X Links</h3>
            <p className="text-gray-500 text-xs">Fetch tweet content for Notion entries with empty Notes</p>
          </div>
        </div>
        <button
          className={btnClass}
          disabled={results['enrich-x']?.loading}
          onClick={() => runAction('enrich-x', '/actions/enrich-x-links')}
        >
          {results['enrich-x']?.loading ? 'Running...' : 'Enrich X Links'}
        </button>
        {renderResult('enrich-x')}
      </div>

      {/* Book Search */}
      <div className={actionCardClass}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">📚</span>
          <div>
            <h3 className="text-gray-100 font-medium">Book Search</h3>
            <p className="text-gray-500 text-xs">Compare prices across Everand, Storytel, Audible, Google Play, Amazon</p>
          </div>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            className={inputClass}
            placeholder="Book title or author..."
            value={bookQuery}
            onChange={e => setBookQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && bookQuery.trim()) {
                runAction('book-search', '/actions/book-search', { input: bookQuery });
              }
            }}
          />
          <button
            className={btnClass}
            disabled={!bookQuery.trim() || results['book-search']?.loading}
            onClick={() => runAction('book-search', '/actions/book-search', { input: bookQuery })}
          >
            {results['book-search']?.loading ? '...' : 'Search'}
          </button>
        </div>
        {renderResult('book-search')}
      </div>

      {/* Reset Session */}
      <div className={actionCardClass}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">🔄</span>
          <div>
            <h3 className="text-gray-100 font-medium">Reset Session</h3>
            <p className="text-gray-500 text-xs">Clear PAI conversation context</p>
          </div>
        </div>
        {!resetConfirm ? (
          <button
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded transition-colors"
            onClick={() => setResetConfirm(true)}
          >
            Reset Session
          </button>
        ) : (
          <div className="flex gap-2 items-center">
            <span className="text-yellow-400 text-sm">Are you sure?</span>
            <button
              className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs rounded transition-colors"
              disabled={results['reset']?.loading}
              onClick={() => {
                setResetConfirm(false);
                runAction('reset', '/actions/reset-session');
              }}
            >
              {results['reset']?.loading ? '...' : 'Yes, Reset'}
            </button>
            <button
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
              onClick={() => setResetConfirm(false)}
            >
              Cancel
            </button>
          </div>
        )}
        {renderResult('reset')}
      </div>
    </div>
  );

  const renderPrompts = () => {
    if (promptsLoading) {
      return (
        <div className="text-gray-400 text-center py-8 animate-pulse">Loading prompts...</div>
      );
    }
    if (promptsError) {
      return (
        <div className="space-y-3">
          <div className="bg-red-500/20 text-red-400 p-3 rounded">{promptsError}</div>
          <button className={btnClass} onClick={fetchPrompts}>Retry</button>
        </div>
      );
    }
    if (prompts.length === 0) {
      return <div className="text-gray-500 text-center py-8">No prompts found</div>;
    }

    return (
      <div className="space-y-3">
        {prompts.map(prompt => {
          const isExpanded = expandedPrompt === prompt.id;
          const isEditing = editingPrompt === prompt.id;
          const isSaving = savingPrompt === prompt.id;
          const currentTemplate = editedTemplates[prompt.id] ?? prompt.template;
          const isShowingDefault = showDefault === prompt.id;

          return (
            <div key={prompt.id} className="bg-gray-800 rounded-lg border border-gray-700">
              {/* Prompt card header */}
              <button
                className="w-full p-4 text-left flex items-start justify-between hover:bg-gray-750 transition-colors"
                onClick={() => setExpandedPrompt(isExpanded ? null : prompt.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-gray-100 font-medium text-sm">{prompt.name}</h3>
                    <span className="text-xs px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-400">
                      {prompt.category}
                    </span>
                    {prompt.is_modified && (
                      <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
                        modified
                      </span>
                    )}
                  </div>
                  <p className="text-gray-500 text-xs">{prompt.description}</p>
                </div>
                <span className="text-gray-500 text-sm ml-2">
                  {isExpanded ? '▲' : '▼'}
                </span>
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="px-4 pb-4 border-t border-gray-700 pt-3">
                  {/* Action buttons */}
                  <div className="flex gap-2 mb-3">
                    {!isEditing ? (
                      <button
                        className={btnSmClass}
                        onClick={() => {
                          setEditingPrompt(prompt.id);
                          setEditedTemplates(prev => ({ ...prev, [prompt.id]: prompt.template }));
                        }}
                      >
                        Edit
                      </button>
                    ) : (
                      <>
                        <button
                          className={btnSmClass}
                          disabled={isSaving}
                          onClick={() => savePrompt(prompt.id)}
                        >
                          {isSaving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
                          onClick={() => {
                            setEditingPrompt(null);
                            setEditedTemplates(prev => {
                              const next = { ...prev };
                              delete next[prompt.id];
                              return next;
                            });
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    {prompt.is_modified && (
                      <>
                        <button
                          className="px-3 py-1.5 bg-red-600/80 hover:bg-red-500 text-white text-xs rounded transition-colors"
                          onClick={() => resetPrompt(prompt.id)}
                        >
                          Reset to Default
                        </button>
                        <button
                          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
                          onClick={() => setShowDefault(isShowingDefault ? null : prompt.id)}
                        >
                          {isShowingDefault ? 'Hide Default' : 'Show Default'}
                        </button>
                      </>
                    )}
                  </div>

                  {/* Show default template */}
                  {isShowingDefault && prompt.default_template && (
                    <div className="mb-3 p-3 bg-gray-900 rounded border border-gray-600">
                      <div className="text-xs text-gray-500 mb-1 font-medium">Default template:</div>
                      <pre className="text-gray-400 text-xs whitespace-pre-wrap font-mono">{prompt.default_template}</pre>
                    </div>
                  )}

                  {/* Template textarea */}
                  <textarea
                    className={`w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 font-mono min-h-[200px] resize-y focus:outline-none focus:border-indigo-500 ${
                      !isEditing ? 'cursor-default' : ''
                    }`}
                    readOnly={!isEditing}
                    value={isEditing ? currentTemplate : prompt.template}
                    onChange={e => {
                      if (isEditing) {
                        setEditedTemplates(prev => ({ ...prev, [prompt.id]: e.target.value }));
                      }
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 p-4">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <button onClick={onBack} className="text-gray-400 hover:text-white">
            ← Back
          </button>
          <h1 className="text-xl font-semibold">PAI Actions</h1>
          <div className="w-16" /> {/* Spacer for alignment */}
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4">
        {/* Sub-tabs */}
        <div className="flex gap-1 mb-6">
          {(['actions', 'prompts'] as SubTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {tab === 'actions' ? 'Actions' : 'Prompts'}
            </button>
          ))}
        </div>

        {/* Content */}
        {activeTab === 'actions' ? renderActions() : renderPrompts()}
      </div>
    </div>
  );
}

export default ActionsPanel;
