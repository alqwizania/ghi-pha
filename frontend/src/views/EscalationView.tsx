
import { useState, useEffect } from 'react';
import { fetchEscalations } from '../lib/api';

const EscalationView = () => {
    const [escalations, setEscalations] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchEscalations()
            .then(data => {
                setEscalations(data);
            })
            .finally(() => setLoading(false));
    }, []);

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <div className="text-ghi-teal font-black animate-pulse uppercase tracking-[0.3em]">Querying High-Level Directives...</div>
        </div>
    );

    if (escalations.length === 0) return (
        <div className="text-center py-20 glass-panel rounded-[2.5rem] border border-white/5">
            <p className="text-slate-500 font-black text-xs uppercase tracking-[0.3em]">No active escalations in the command chain</p>
        </div>
    );

    const escalation = escalations[0];

    return (
        <div className="max-w-4xl mx-auto space-y-10 animate-in fade-in slide-in-from-top-4 duration-1000">
            <div className="glass-panel p-10 rounded-[3rem] border border-ghi-critical/20 relative overflow-hidden shadow-2xl shadow-ghi-critical/10">
                <div className="absolute top-0 right-0 p-8">
                    <div className="w-16 h-16 rounded-full border border-ghi-critical/20 flex items-center justify-center animate-pulse">
                        <div className="w-8 h-8 rounded-full bg-ghi-critical/20 flex items-center justify-center">
                            <div className="w-3 h-3 rounded-full bg-ghi-critical shadow-[0_0_15px_#FF3131]"></div>
                        </div>
                    </div>
                </div>

                <div className="relative z-10">
                    <span className="px-4 py-1.5 rounded-full bg-ghi-critical/10 text-ghi-critical text-[10px] font-black uppercase tracking-[0.2em] border border-ghi-critical/30 mb-8 inline-block shadow-[0_0_15px_rgba(255,49,49,0.1)]">
                        Strategic Alert Level 5
                    </span>
                    <h2 className="text-4xl font-black text-white mb-4 uppercase tracking-tighter leading-none">
                        {escalation.signal?.disease} Escalation
                    </h2>
                    <p className="text-slate-400 font-medium text-sm leading-relaxed mb-10 max-w-2xl">
                        Intelligence indicates significant risk to national health security. Emergency authorization requested for cross-sector response mobilization.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-12 py-10 border-y border-white/5">
                        <div className="space-y-6">
                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Assessment Consensus</h4>
                            <div className="space-y-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-5 h-5 rounded-full bg-ghi-success/20 flex items-center justify-center text-ghi-success">
                                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                    </div>
                                    <p className="text-xs font-black text-white uppercase tracking-widest">Public Health Impact: SEVERE</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="w-5 h-5 rounded-full bg-ghi-success/20 flex items-center justify-center text-ghi-success">
                                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                    </div>
                                    <p className="text-xs font-black text-white uppercase tracking-widest">International Spread: HIGH RISK</p>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-6">
                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Response Directives</h4>
                            <div className="space-y-4">
                                <p className="text-[11px] text-slate-400 font-medium leading-relaxed uppercase tracking-widest border-l-2 border-ghi-critical/50 pl-4 py-1">
                                    1. Immediate notification to WHO Regional Office.
                                    <br />2. Mobilization of RRT Alpha to {escalation.signal?.location}.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="pt-10 flex gap-6">
                        <button className="flex-1 py-5 bg-ghi-critical/10 hover:bg-ghi-critical/20 text-ghi-critical font-black text-[11px] uppercase tracking-[0.4em] rounded-2xl transition-all border border-ghi-critical/30 relative overflow-hidden group">
                            AUTHORIZE ESCALATION
                        </button>
                        <button className="px-10 py-5 glass-panel hover:bg-white/5 text-slate-500 hover:text-white font-black text-[11px] uppercase tracking-[0.4em] rounded-2xl transition-all border border-white/10">
                            DE-ESCALATE
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default EscalationView;
