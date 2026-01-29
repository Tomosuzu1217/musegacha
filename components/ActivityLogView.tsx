
import { useState, useEffect } from 'react';
import { ActivityLogEntry, UserInterestProfile } from '../types';
import { storageService } from '../services/storageService';

const TYPE_LABELS: Record<string, { label: string; icon: string }> = {
  consultation: { label: 'CONSULT', icon: 'C' },
  question_generated: { label: 'Q GEN', icon: 'Q' },
  session_completed: { label: 'SESSION', icon: 'S' },
  gacha_spin: { label: 'SPIN', icon: 'G' },
};

export const ActivityLogView: React.FC = () => {
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserInterestProfile>(() => storageService.getUserProfile());

  useEffect(() => {
    setLogs(storageService.getActivityLog());
    setProfile(storageService.getUserProfile());
  }, []);

  const filteredLogs = filter ? logs.filter(l => l.type === filter) : logs;

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const topThemes = Object.entries(profile.themes)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  return (
    <div className="animate-in fade-in duration-500">
      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="text-center p-4 border border-gray-200 rounded-lg">
          <p className="text-2xl font-bold font-display">{profile.totalConsultations}</p>
          <p className="text-[9px] text-gray-400 font-mono uppercase mt-1">Consults</p>
        </div>
        <div className="text-center p-4 border border-gray-200 rounded-lg">
          <p className="text-2xl font-bold font-display">{profile.totalQuestionsGenerated}</p>
          <p className="text-[9px] text-gray-400 font-mono uppercase mt-1">Generated</p>
        </div>
        <div className="text-center p-4 border border-gray-200 rounded-lg">
          <p className="text-2xl font-bold font-display">{profile.totalSessionsCompleted}</p>
          <p className="text-[9px] text-gray-400 font-mono uppercase mt-1">Sessions</p>
        </div>
      </div>

      {/* Top Themes */}
      {topThemes.length > 0 && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">TOP THEMES</p>
          <div className="space-y-2">
            {topThemes.map(([theme, count]) => (
              <div key={theme} className="flex items-center gap-3">
                <span className="text-xs font-mono text-gray-600 w-28 truncate">{theme}</span>
                <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-black rounded-full transition-all"
                    style={{ width: `${Math.min(100, (count / topThemes[0][1]) * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-gray-400 w-6 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter Pills */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setFilter(null)}
          className={`text-[10px] px-3 py-1 rounded-full font-bold uppercase tracking-wider border ${
            filter === null ? 'bg-black text-white border-black' : 'bg-white text-gray-500 border-gray-200'
          }`}
        >
          ALL
        </button>
        {Object.entries(TYPE_LABELS).map(([key, { label }]) => (
          <button
            key={key}
            onClick={() => setFilter(filter === key ? null : key)}
            className={`text-[10px] px-3 py-1 rounded-full font-bold uppercase tracking-wider border ${
              filter === key ? 'bg-black text-white border-black' : 'bg-white text-gray-500 border-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Timeline */}
      {filteredLogs.length === 0 ? (
        <div className="py-16 text-center border border-dashed border-gray-200 rounded-lg">
          <p className="font-mono text-gray-400 text-sm">No activity yet</p>
        </div>
      ) : (
        <div className="space-y-1">
          {filteredLogs.slice(0, 50).map(entry => {
            const typeInfo = TYPE_LABELS[entry.type] || { label: '?', icon: '?' };
            return (
              <div key={entry.id} className="flex items-start gap-3 py-2 border-b border-gray-50">
                <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-[9px] font-bold font-mono text-gray-500">{typeInfo.icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-700 truncate">{entry.detail}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[9px] font-mono text-gray-300">{formatTime(entry.timestamp)}</span>
                    <span className="text-[9px] font-mono text-gray-300">{typeInfo.label}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
