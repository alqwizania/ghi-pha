import { useState, useEffect } from 'react';
import { fetchEscalations } from '../lib/api';

const EscalationView = () => {
    const [escalations, setEscalations] = useState<any[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchEscalations()
            .then(data => {
                setEscalations(data);
                if (data.length > 0) setSelectedId(data[0].id);
            })
            .finally(() => setLoading(false));
    }, []);

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <div className="text-ghi-teal font-black animate-pulse uppercase tracking-[0.3em]">Querying Strategic Directives...</div>
        </div>
    );

    if (escalations.length === 0) return (
        <div className="text-center py-20 glass-panel rounded-[2.5rem] border border-white/5">
            <p className="text-slate-500 font-black text-xs uppercase tracking-[0.3em]">No active escalations in the command chain</p>
        </div>
    );

    const activeE = escalations.find(e => e.id === selectedId) || escalations[0];

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 text-slate-100 animate-in fade-in slide-in-from-top-4 duration-1000">
            {/* Left: Escalation List */}
            <div className="lg:col-span-4 space-y-4 overflow-y-auto max-h-[calc(100vh-200px)] pr-2">
                <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.3em] mb-4 ml-2">Escalation Queue</h4>
                {escalations.map(e => (
                    <button
                        key={e.id}
                        onClick={() => setSelectedId(e.id)}
                        className={`w-full glass-panel p-6 text-left border transition-all rounded-3xl ${selectedId === e.id ? 'border-ghi-critical/50 bg-ghi-critical/5' : 'border-white/5 hover:border-white/20'}`}
                    >
                        <div className="flex justify-between items-start mb-2">
                            <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase ${e.priority === 'Critical' ? 'bg-ghi-critical/20 text-ghi-critical' : 'bg-ghi-warning/20 text-ghi-warning'}`}>
                                {e.priority}
                            </span>
                            <span className="text-[10px] text-slate-600 font-bold">{new Date(e.escalatedAt).toLocaleDateString()}</span>
                        </div>
                        <h3 className="text-sm font-black text-white uppercase tracking-wider">{e.signal?.disease}</h3>
                        <p className="text-[10px] text-slate-500 uppercase font-black mt-1">{e.signal?.country}</p>
                    </button>
                ))}
            </div>

            {/* Right: Detailed Briefing */}
            <div className="lg:col-span-8">
                <div className="glass-panel p-8 lg:p-12 rounded-[3rem] border border-ghi-critical/20 relative overflow-hidden shadow-2xl shadow-ghi-critical/10 min-h-full">
                    <div className="absolute top-0 right-0 p-8 hidden md:block">
                        <div className="w-16 h-16 rounded-full border border-ghi-critical/20 flex items-center justify-center animate-pulse">
                            <div className="w-8 h-8 rounded-full bg-ghi-critical/20 flex items-center justify-center">
                                <div className="w-3 h-3 rounded-full bg-ghi-critical shadow-[0_0_15px_#FF3131]"></div>
                            </div>
                        </div>
                    </div>

                    <div className="relative z-10">
                        <div className="flex flex-wrap items-center gap-4 mb-8">
                            <span className="px-4 py-1.5 rounded-full bg-ghi-critical/10 text-ghi-critical text-[11px] font-black uppercase tracking-[0.2em] border border-ghi-critical/30 shadow-[0_0_15px_rgba(255,49,49,0.1)]">
                                Strategic Briefing
                            </span>
                            <span className="text-slate-500 text-[10px] font-black uppercase tracking-widest">Signal ID: EVT-{activeE.signal?.id.slice(0, 8)}</span>
                        </div>

                        <h2 className="text-3xl lg:text-5xl font-black text-white mb-4 uppercase tracking-tighter leading-none">
                            {activeE.signal?.disease} DETECTED
                        </h2>
                        <p className="text-ghi-teal font-black text-sm uppercase tracking-[0.2em] mb-10">{activeE.signal?.country} // Level 5 Assessment</p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-10 border-y border-white/5 mb-10">
                            <div className="space-y-6">
                                <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest">IHR Matrix Data</h4>
                                <div className="space-y-3">
                                    {[
                                        { label: 'Public Health Impact', value: 'Serious' },
                                        { label: 'Event Classification', value: 'Unexpected' },
                                        { label: 'Intl. Spread Risk', value: 'Confirmed' }
                                    ].map((item, i) => (
                                        <div key={i} className="flex items-center gap-3">
                                            <div className="w-4 h-4 rounded-full bg-ghi-success/20 flex items-center justify-center text-ghi-success">
                                                <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                            </div>
                                            <p className="text-[11px] font-black text-white uppercase tracking-widest">{item.label}: {item.value}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-6">
                                <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest">RRA Findings</h4>
                                <div className="p-4 bg-ghi-critical/5 rounded-2xl border border-ghi-critical/20">
                                    <p className="text-[11px] font-black text-ghi-critical uppercase mb-1">Risk Directive</p>
                                    <p className="text-[12px] text-white font-bold leading-relaxed">{activeE.escalationReason}</p>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-6 mb-10">
                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Recommended Actions</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 text-center">
                                    <p className="text-[10px] font-black text-slate-600 uppercase mb-1">Global</p>
                                    <p className="text-[11px] font-black text-white uppercase italic">Notify WHO</p>
                                </div>
                                <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 text-center">
                                    <p className="text-[10px] font-black text-slate-600 uppercase mb-1">National</p>
                                    <p className="text-[11px] font-black text-white uppercase italic">Deploy RRT</p>
                                </div>
                                <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 text-center">
                                    <p className="text-[10px] font-black text-slate-600 uppercase mb-1">Borders</p>
                                    <p className="text-[11px] font-black text-white uppercase italic">Travel Alert</p>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-4">
                            <button className="flex-1 py-5 bg-ghi-critical/20 hover:bg-ghi-critical/30 text-ghi-critical font-black text-[11px] uppercase tracking-[0.4em] rounded-2xl transition-all border border-ghi-critical/40 shadow-xl relative overflow-hidden group">
                                <span className="relative z-10">AUTHORIZE MISSION</span>
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
                            </button>
                            <button className="flex-1 py-5 glass-panel hover:bg-white/5 text-slate-500 hover:text-white font-black text-[11px] uppercase tracking-[0.4em] rounded-2xl transition-all border border-white/10">
                                REQUEST CLARIFICATION
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default EscalationView;
