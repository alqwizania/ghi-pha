import { useState, useEffect } from 'react';
import { fetchSignals, acceptSignal, rejectSignal } from '../lib/api';
import { LayoutGrid, List, Clock, ExternalLink, CheckCircle, XCircle, Filter, Radio, Globe } from 'lucide-react';

export default function Triage({ user }: any) {
  const [allSignals, setAllSignals] = useState<any[]>([]);
  const [filteredSignals, setFilteredSignals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'card' | 'line'>('card');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'listener' | 'radar'>('all');
  const [diseaseFilter, setDiseaseFilter] = useState('ALL DISEASES');
  const [regionFilter, setRegionFilter] = useState('ALL REGIONS');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const canAction = user?.permissions?.triage === 'edit' || user?.permissions?.triage === 'update' || user?.role === 'Admin' || user?.role === 'Superadmin';


  const loadSignals = async () => {
    setLoading(true);
    try {
      const data = await fetchSignals();
      const pending = data
        .filter((s: any) => s.triageStatus === 'Pending Triage' || !s.triageStatus)
        .sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

      setAllSignals(pending);
      setLoadError(null);
    } catch (err) {
      // Was a fallback to invented signals carrying fabricated priority scores.
      // An empty queue and a broken API are completely different situations,
      // and an analyst has to be able to tell them apart before deciding there
      // is nothing to work on.
      setAllSignals([]);
      setLoadError(err instanceof Error ? err.message : 'Could not reach the surveillance API');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSignals();
  }, []);

  useEffect(() => {
    let filtered = allSignals;
    if (sourceFilter !== 'all') {
      filtered = filtered.filter(s => (s.sourceOrigin || 'radar') === sourceFilter);
    }
    if (diseaseFilter !== 'ALL DISEASES') {
      filtered = filtered.filter(s => s.disease === diseaseFilter);
    }
    if (regionFilter !== 'ALL REGIONS') {
      filtered = filtered.filter(s => s.country === regionFilter);
    }
    setFilteredSignals(filtered);
  }, [sourceFilter, diseaseFilter, regionFilter, allSignals]);

  const handleAction = async (signalId: string, type: 'accept' | 'reject') => {
    setProcessingId(signalId);
    try {
      if (type === 'accept') await acceptSignal(signalId);
      else await rejectSignal(signalId);
      setAllSignals(prev => prev.filter(s => s.id !== signalId));
    } catch {
      setAllSignals(prev => prev.filter(s => s.id !== signalId));
    } finally {
      setProcessingId(null);
    }
  };

  const getSLAString = (deadlineIso?: string) => {
    // Was '24h SLA Active' — a reassuring green label shown on every row
    // because no signal had ever been given a deadline. An unmeasured
    // compliance signal is worse than a missing one, so say what is true.
    if (!deadlineIso) return 'No deadline set';
    const diffMs = new Date(deadlineIso).getTime() - Date.now();
    if (diffMs <= 0) return 'SLA Expired';
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${mins}m remaining`;
  };

  const uniqueDiseases = Array.from(new Set(allSignals.map(s => s.disease))).sort();
  const uniqueRegions = Array.from(new Set(allSignals.map(s => s.country))).sort();

  return (
    <div className="space-y-6 pb-12">
      {loadError && (
        <div className="rounded-2xl border border-ghi-critical/50 bg-ghi-critical/10 p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-ghi-critical shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
              d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0L3.16 16.25A2 2 0 005 19z"/>
          </svg>
          <div>
            <p className="text-[11px] font-black text-ghi-critical uppercase tracking-widest">Surveillance data unavailable</p>
            <p className="text-[11px] text-slate-300 mt-1">{loadError}</p>
            <p className="text-[10px] text-slate-500 mt-1">
              Nothing below is current. This is a connection failure, not an all-clear.
            </p>
          </div>
        </div>
      )}
      {/* Header Bar with Mode Toggle */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-[#0A0F1C]/80 border border-white/10 rounded-2xl p-6 backdrop-blur-md">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-black tracking-wider uppercase text-white">Signal Triage Center</h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-ghi-teal/20 text-ghi-teal border border-ghi-teal/40">
              {filteredSignals.length} Pending
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Standard operating procedure 1st and 2nd tier signal verification and risk evaluation.
          </p>
        </div>

        {/* Controls: Source Filter & View Switcher */}
        <div className="flex items-center gap-3">
          {/* Source Stream Filter */}
          <div className="flex items-center p-1 rounded-xl bg-slate-950 border border-white/10">
            <button
              onClick={() => setSourceFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-black uppercase transition-all ${
                sourceFilter === 'all' ? 'bg-ghi-teal/20 text-ghi-teal border border-ghi-teal/40' : 'text-slate-400 hover:text-white'
              }`}
            >
              All Signals
            </button>
            <button
              onClick={() => setSourceFilter('radar')}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-black uppercase transition-all flex items-center gap-1.5 ${
                sourceFilter === 'radar' ? 'bg-ghi-teal/20 text-ghi-teal border border-ghi-teal/40' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Globe className="w-3.5 h-3.5" /> Radar
            </button>
            <button
              onClick={() => setSourceFilter('listener')}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-black uppercase transition-all flex items-center gap-1.5 ${
                sourceFilter === 'listener' ? 'bg-ghi-teal/20 text-ghi-teal border border-ghi-teal/40' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Radio className="w-3.5 h-3.5" /> Listener
            </button>
          </div>

          {/* Card vs Line-Listing Toggle */}
          <div className="flex items-center p-1 rounded-xl bg-slate-950 border border-white/10">
            <button
              onClick={() => setViewMode('card')}
              className={`p-2 rounded-lg transition-all ${
                viewMode === 'card' ? 'bg-ghi-teal text-slate-950 shadow-[0_0_12px_#00F2FF]' : 'text-slate-400 hover:text-white'
              }`}
              title="Card View"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('line')}
              className={`p-2 rounded-lg transition-all ${
                viewMode === 'line' ? 'bg-ghi-teal text-slate-950 shadow-[0_0_12px_#00F2FF]' : 'text-slate-400 hover:text-white'
              }`}
              title="Line-Listing View"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Filter Dropdowns */}
      <div className="flex flex-wrap gap-4 bg-ghi-teal/5 p-4 rounded-2xl border border-ghi-teal/10">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-ghi-teal" />
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Filters:</span>
        </div>
        <select
          value={diseaseFilter}
          onChange={(e) => setDiseaseFilter(e.target.value)}
          className="bg-ghi-navy border-white/10 text-[11px] font-bold text-slate-300 rounded-xl px-4 py-2 outline-none uppercase cursor-pointer hover:bg-slate-900"
        >
          <option className="bg-slate-900 text-white">ALL DISEASES</option>
          {uniqueDiseases.map(d => <option key={d} value={d} className="bg-slate-900 text-white">{d}</option>)}
        </select>
        <select
          value={regionFilter}
          onChange={(e) => setRegionFilter(e.target.value)}
          className="bg-ghi-navy border-white/10 text-[11px] font-bold text-slate-300 rounded-xl px-4 py-2 outline-none uppercase cursor-pointer hover:bg-slate-900"
        >
          <option className="bg-slate-900 text-white">ALL REGIONS</option>
          {uniqueRegions.map(r => <option key={r} value={r} className="bg-slate-900 text-white">{r}</option>)}
        </select>
      </div>

      {/* Main View Display */}
      {loading ? (
        <div className="flex items-center justify-center h-64 text-ghi-teal text-xs font-black uppercase tracking-widest animate-pulse">
          Synchronizing Triage Queue...
        </div>
      ) : filteredSignals.length === 0 ? (
        <div className="glass-panel p-12 rounded-3xl border border-white/5 text-center text-slate-500 text-xs font-bold uppercase tracking-wider">
          No pending signals match the selected filters.
        </div>
      ) : viewMode === 'card' ? (
        /* CARD VIEW */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredSignals.map((signal) => {
            const isProcessing = processingId === signal.id;
            const isCritical = Number(signal.priorityScore) > 85;

            return (
              <div
                key={signal.id}
                className={`glass-panel p-6 rounded-3xl border border-white/5 relative overflow-hidden transition-all duration-300 hover:border-ghi-teal/30 ${
                  isCritical ? 'ring-1 ring-ghi-critical/30' : ''
                }`}
              >
                {/* Source Origin Badge */}
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                      signal.sourceOrigin === 'listener' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40' : 'bg-ghi-teal/20 text-ghi-teal border border-ghi-teal/40'
                    }`}>
                      {signal.sourceOrigin === 'listener' ? 'Listener' : 'Radar'}
                    </span>
                    {signal.sourceName && (
                      <span className="text-[10px] text-slate-400 font-medium">via {signal.sourceName}</span>
                    )}
                  </div>

                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
                    isCritical ? 'bg-ghi-critical/20 text-ghi-critical border border-ghi-critical/30' : 'bg-ghi-warning/20 text-ghi-warning border border-ghi-warning/30'
                  }`}>
                    Priority {signal.priorityScore}
                  </span>
                </div>

                <h3 className="text-xl font-black text-white uppercase tracking-wider mb-1">{signal.disease}</h3>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-4">
                  {signal.country} {signal.location ? `• ${signal.location}` : ''}
                </p>

                <div className="grid grid-cols-3 gap-4 py-4 border-y border-white/5 text-xs mb-4">
                  <div>
                    <span className="text-[10px] text-slate-500 font-bold uppercase block">Cases</span>
                    <span className="text-white font-black text-base">{signal.cases}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-bold uppercase block">Deaths</span>
                    <span className="text-white font-black text-base">{signal.deaths}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-bold uppercase block">24h SLA</span>
                    <span className="text-ghi-teal font-bold flex items-center gap-1 text-[11px] mt-0.5">
                      <Clock className="w-3 h-3" /> {getSLAString(signal.verificationDeadline)}
                    </span>
                  </div>
                </div>

                <p className="text-slate-400 text-xs line-clamp-3 mb-6 font-medium leading-relaxed italic">
                  "{signal.description}"
                </p>

                <div className="flex gap-3">
                  <button
                    disabled={!canAction || isProcessing}
                    onClick={() => handleAction(signal.id, 'reject')}
                    className="flex-1 py-2.5 rounded-xl bg-slate-900 hover:bg-ghi-critical/20 text-slate-300 hover:text-ghi-critical text-[11px] font-black uppercase tracking-widest border border-white/10 transition-all flex items-center justify-center gap-1.5"
                  >
                    <XCircle className="w-4 h-4" /> Reject
                  </button>
                  <button
                    disabled={!canAction || isProcessing}
                    onClick={() => handleAction(signal.id, 'accept')}
                    className="flex-1 py-2.5 rounded-xl bg-ghi-teal/20 hover:bg-ghi-teal text-ghi-teal hover:text-slate-950 text-[11px] font-black uppercase tracking-widest border border-ghi-teal/40 transition-all flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(0,242,255,0.2)]"
                  >
                    <CheckCircle className="w-4 h-4" /> Accept for Assessment
                  </button>
                  <a
                    href={signal.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white border border-white/10 transition-all flex items-center justify-center"
                    title="View Source"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* LINE-LISTING TABLE VIEW */
        <div className="glass-panel rounded-2xl border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 bg-slate-950/60 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <th className="p-4">Origin Stream</th>
                  <th className="p-4">Disease / Event</th>
                  <th className="p-4">Location</th>
                  <th className="p-4">Cases / Deaths</th>
                  <th className="p-4">Priority Score</th>
                  <th className="p-4">24h Verification SLA</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-xs font-medium">
                {filteredSignals.map((signal) => {
                  const isProcessing = processingId === signal.id;
                  const isCritical = Number(signal.priorityScore) > 85;

                  return (
                    <tr key={signal.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                          signal.sourceOrigin === 'listener' ? 'bg-purple-500/20 text-purple-300' : 'bg-ghi-teal/20 text-ghi-teal'
                        }`}>
                          {signal.sourceOrigin === 'listener' ? 'Listener' : 'Radar'}
                        </span>
                      </td>

                      <td className="p-4 font-bold text-white">
                        <div>{signal.disease}</div>
                        <div className="text-[10px] text-slate-400 font-normal line-clamp-1">{signal.description}</div>
                      </td>

                      <td className="p-4 text-slate-300 font-bold uppercase">
                        {signal.country}
                      </td>

                      <td className="p-4 text-slate-300 font-bold">
                        {signal.cases} / <span className="text-ghi-critical">{signal.deaths}</span>
                      </td>

                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded font-black ${
                          isCritical ? 'text-ghi-critical bg-ghi-critical/10' : 'text-ghi-teal bg-ghi-teal/10'
                        }`}>
                          {signal.priorityScore}
                        </span>
                      </td>

                      <td className="p-4 text-slate-400 text-[11px] font-bold">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-ghi-teal" />
                          {getSLAString(signal.verificationDeadline)}
                        </span>
                      </td>

                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            disabled={!canAction || isProcessing}
                            onClick={() => handleAction(signal.id, 'reject')}
                            className="px-3 py-1 rounded-lg bg-slate-900 hover:bg-ghi-critical/20 text-slate-400 hover:text-ghi-critical text-[10px] font-bold uppercase transition-all"
                          >
                            Reject
                          </button>
                          <button
                            disabled={!canAction || isProcessing}
                            onClick={() => handleAction(signal.id, 'accept')}
                            className="px-3 py-1 rounded-lg bg-ghi-teal/20 hover:bg-ghi-teal text-ghi-teal hover:text-slate-950 text-[10px] font-bold uppercase transition-all"
                          >
                            Accept
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
