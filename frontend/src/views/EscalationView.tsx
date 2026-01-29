

const EscalationView = () => {
    return (
        <div className="space-y-10 max-w-6xl mx-auto animate-in fade-in slide-in-from-top-4 duration-1000 pb-12">
            {/* Header with Urgency indicator */}
            <div className="flex justify-between items-center glass-panel p-8 rounded-3xl border-l-4 border-l-ghi-critical relative overflow-hidden shadow-2xl shadow-ghi-critical/5">
                <div className="absolute top-0 right-0 w-32 h-32 bg-ghi-critical/5 blur-3xl rounded-full -mr-16 -mt-16"></div>
                <div className="relative z-10">
                    <span className="text-ghi-critical text-[10px] font-black uppercase tracking-[0.3em] flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-ghi-critical pulse-critical shadow-[0_0_10px_#FF3131]"></span>
                        Action Level: Alpha // Immediate Execution
                    </span>
                    <h2 className="text-3xl font-black text-white mt-2 uppercase tracking-widest">Escalated Cluster: MERS-CoV</h2>
                </div>
                <div className="text-right relative z-10">
                    <p className="text-slate-500 text-[9px] font-black uppercase tracking-widest mb-1">Authorization Source</p>
                    <p className="text-white font-black text-xs uppercase tracking-widest">A. Al-Otaibi <span className="text-ghi-teal ml-1">// SENIOR ANALYST</span></p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-10">
                {/* Situation Summary */}
                <div className="lg:col-span-2 space-y-8">
                    <div className="glass-panel p-8 rounded-[2rem] border border-ghi-blue/10 relative overflow-hidden h-full">
                        <h4 className="text-[10px] font-black text-white mb-8 uppercase tracking-[0.3em] flex items-center gap-3">
                            <span className="w-1.5 h-1.5 rounded-full bg-ghi-teal shadow-[0_0_8px_#00F2FF]"></span>
                            Neural Signal Summary
                        </h4>

                        <div className="grid grid-cols-2 gap-4 mb-8">
                            <div className="p-5 bg-white/[0.02] rounded-2xl border border-white/5">
                                <p className="text-slate-500 text-[9px] uppercase font-black tracking-widest mb-1">Index Cases</p>
                                <p className="text-white text-2xl font-black uppercase">08 <span className="text-[10px] text-slate-600 font-bold ml-1">Confirmed</span></p>
                            </div>
                            <div className="p-5 bg-white/[0.02] rounded-2xl border border-white/5">
                                <p className="text-slate-500 text-[9px] uppercase font-black tracking-widest mb-1">Mortality</p>
                                <p className="text-ghi-critical text-2xl font-black uppercase neon-text">25% <span className="text-[10px] text-slate-600 font-bold ml-1">Ratio</span></p>
                            </div>
                        </div>

                        <div className="space-y-6 text-[11px] text-slate-400 leading-relaxed font-medium uppercase tracking-[0.05em]">
                            <p className="text-white font-black border-l-2 border-ghi-teal pl-4 py-1 mb-4">Analyst Assessment Matrix:</p>
                            <p className="bg-white/[0.02] p-6 rounded-2xl border border-white/5 italic">
                                "Nosocomial vector confirmed in Riyadh metro zone. Healthcare personnel isolation protocol engaged. IHR matrix triggered via 3-point neural consensus."
                            </p>
                        </div>
                    </div>
                </div>

                {/* Director Decision Panel */}
                <div className="lg:col-span-3 glass-panel p-10 rounded-[2.5rem] border border-ghi-blue/20 bg-ghi-blue/5 relative overflow-hidden shadow-2xl shadow-ghi-blue/5">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-ghi-blue/10 blur-[80px] rounded-full -mr-32 -mt-32"></div>

                    <h4 className="text-[10px] font-black text-white mb-10 uppercase tracking-[0.3em] flex items-center gap-3 relative z-10">
                        <span className="w-1.5 h-1.5 rounded-full bg-ghi-critical pulse-critical shadow-[0_0_10px_#FF3131]"></span>
                        Director Command Authorization
                    </h4>

                    <div className="space-y-8 relative z-10">
                        <label className="block">
                            <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest ml-1">Selected Protocol Path</span>
                            <select className="mt-3 w-full bg-ghi-navy/80 border border-white/10 text-[11px] font-black tracking-widest text-white rounded-2xl px-6 py-4 focus:ring-1 ring-ghi-teal transition-all outline-none uppercase appearance-none shadow-inner">
                                <option>AUTHORIZE WHO NOTIFICATION</option>
                                <option>REQUEST DEEP NEURAL RE-SCAN</option>
                                <option>INTERNAL QUARANTINE ONLY</option>
                            </select>
                        </label>

                        <div className="space-y-4">
                            <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest ml-1">Deploy Multi-Stage Actions</p>
                            {[
                                'Activate Bio-Security Operations Center',
                                'Issue Regional Vector Alert',
                                'Neural Notification to WHO Focal Point',
                                'Deploy Rapid Response Recon Unit'
                            ].map((action, i) => (
                                <label key={i} className="flex items-center gap-4 p-4 bg-white/[0.03] hover:bg-white/[0.08] rounded-2xl border border-white/5 cursor-pointer transition-all group">
                                    <input type="checkbox" className="w-5 h-5 rounded-lg border-white/10 bg-ghi-navy text-ghi-teal focus:ring-ghi-teal focus:ring-offset-ghi-navy transition-all cursor-pointer" />
                                    <span className="text-[10px] text-slate-300 font-black uppercase tracking-widest group-hover:text-ghi-teal transition-colors">{action}</span>
                                </label>
                            ))}
                        </div>

                        <button className="w-full mt-6 py-5 bg-ghi-blue/20 hover:bg-ghi-blue/30 text-ghi-blue font-black text-[11px] uppercase tracking-[0.3em] rounded-2xl transition-all border border-ghi-blue/40 shadow-[0_0_25px_rgba(0,186,255,0.1)] hover:shadow-ghi-blue/20 active:scale-95">
                            EXECUTE AUTHORIZED PROTOCOLS
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default EscalationView;
