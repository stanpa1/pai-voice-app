import React, { useState } from 'react';
import { VoiceName, SystemConfig } from '../types';

interface SetupPanelProps {
  config: SystemConfig;
  onConfigChange: (c: SystemConfig) => void;
  onStart: () => void;
}

export const SetupPanel: React.FC<SetupPanelProps> = ({ config, onConfigChange, onStart }) => {
  const [showSettings, setShowSettings] = useState(false);

  const handleChange = (key: keyof SystemConfig, value: any) => {
    onConfigChange({ ...config, [key]: value });
  };

  return (
    <div className="max-w-md w-full mx-auto p-6 flex flex-col items-center gap-8">
      {/* Logo / Brand */}
      <div className="text-center">
        <div className="inline-block p-4 rounded-full bg-indigo-500/10 mb-4">
          <svg className="w-12 h-12 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold text-white">PAI Voice</h1>
        <p className="text-gray-500 text-sm mt-1">Tap to start conversation</p>
      </div>

      {/* Main Start Button */}
      <button
        onClick={onStart}
        className="w-32 h-32 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-lg shadow-indigo-500/30 transition-all transform hover:scale-105 active:scale-95 flex items-center justify-center"
      >
        <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
        </svg>
      </button>

      {/* Settings Toggle */}
      <button
        onClick={() => setShowSettings(!showSettings)}
        className="text-gray-500 hover:text-gray-300 text-sm flex items-center gap-2 transition-colors"
      >
        <svg className={`w-4 h-4 transition-transform ${showSettings ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        Settings
      </button>

      {/* Collapsible Settings */}
      {showSettings && (
        <div className="w-full bg-gray-800/50 rounded-xl p-4 space-y-4 border border-gray-700/50">
          {/* Voice Selection */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-2">Voice</label>
            <div className="grid grid-cols-5 gap-1">
              {Object.values(VoiceName).map((voice) => (
                <button
                  key={voice}
                  onClick={() => handleChange('voiceName', voice)}
                  className={`p-2 rounded text-xs font-medium transition-all ${
                    config.voiceName === voice
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {voice}
                </button>
              ))}
            </div>
          </div>

          {/* Tools Toggle */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">PAI Tools</span>
            <button
              onClick={() => handleChange('useTools', !config.useTools)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                config.useTools ? 'bg-indigo-600' : 'bg-gray-600'
              }`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                  config.useTools ? 'translate-x-5' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* System Instructions (collapsed by default) */}
          <details className="text-xs">
            <summary className="text-gray-400 cursor-pointer hover:text-gray-300">System Instructions</summary>
            <textarea
              value={config.systemInstruction}
              onChange={(e) => handleChange('systemInstruction', e.target.value)}
              rows={4}
              className="mt-2 w-full bg-gray-900/50 border border-gray-700 rounded p-2 text-gray-300 text-xs focus:ring-1 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </details>

          {/* Webhook (collapsed by default) */}
          <details className="text-xs">
            <summary className="text-gray-400 cursor-pointer hover:text-gray-300">Webhook URL</summary>
            <input
              type="text"
              value={config.webhookUrl || ''}
              onChange={(e) => handleChange('webhookUrl', e.target.value)}
              className="mt-2 w-full bg-gray-900/50 border border-gray-700 rounded p-2 text-gray-300 text-xs font-mono focus:ring-1 focus:ring-indigo-500 focus:border-transparent outline-none"
              placeholder="https://..."
            />
          </details>
        </div>
      )}
    </div>
  );
};
