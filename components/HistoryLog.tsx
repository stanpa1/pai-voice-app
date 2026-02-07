import React from 'react';
import { HistoryItem } from '../types';

interface HistoryLogProps {
  history: HistoryItem[];
  onBack: () => void;
  onClear: () => void;
}

export const HistoryLog: React.FC<HistoryLogProps> = ({ history, onBack, onClear }) => {
  
  const handleExport = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(history, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "nexus_archives.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  return (
    <div className="flex flex-col h-full bg-gray-900">
      <div className="flex items-center justify-between p-6 border-b border-gray-800 bg-gray-900/95 sticky top-0 z-10 backdrop-blur">
        <button 
          onClick={onBack}
          className="text-gray-400 hover:text-white flex items-center gap-2 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          Back
        </button>
        <h2 className="text-xl font-semibold text-white">Archives</h2>
        <div className="flex items-center gap-4">
          <button 
            onClick={handleExport}
            className="text-blue-400 hover:text-blue-300 text-sm font-medium flex items-center gap-1"
          >
             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
             Export JSON
          </button>
          <button 
            onClick={onClear}
            className="text-red-400 hover:text-red-300 text-sm font-medium"
          >
            Clear All
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {history.length === 0 ? (
          <div className="text-center text-gray-500 mt-20">
            <p>No archives found.</p>
          </div>
        ) : (
          history.slice().reverse().map((item) => (
            <div key={item.id} className="bg-gray-800 rounded-xl p-5 border border-gray-700 shadow-sm">
              <div className="flex items-center justify-between mb-4 border-b border-gray-700 pb-2">
                <span className="text-xs font-mono text-gray-400">ID: {item.id.slice(0,8)}</span>
                <span className="text-xs text-gray-400">
                  {new Date(item.timestamp).toLocaleString()} • {item.duration}s
                </span>
              </div>
              <div className="space-y-3">
                {item.transcripts.map((t, idx) => (
                  <div key={idx} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      t.role === 'user' 
                        ? 'bg-blue-900/30 text-blue-200 border border-blue-900/50' 
                        : 'bg-gray-700/50 text-gray-300 border border-gray-600'
                    }`}>
                      <span className="block text-[10px] opacity-50 mb-1 uppercase tracking-wider font-bold">
                        {t.role}
                      </span>
                      {t.text}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};