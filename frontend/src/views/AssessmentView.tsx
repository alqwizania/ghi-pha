import { useState } from 'react';

const AssessmentView = () => {
    const [answers, setAnswers] = useState({
        q1: null,
        q2: null,
        q3: null,
        q4: null
    });

    const handleAnswer = (q: string, val: boolean) => {
        setAnswers({ ...answers, [q]: val });
    };

    const yesCount = Object.values(answers).filter(v => v === true).length;
    const isComplete = Object.values(answers).every(v => v !== null);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 text-slate-100 animate-in fade-in slide-in-from-right-4 duration-1000">
            {/* Sidebar: Signal Info */}
            <div className="lg:col-span-1 space-y-8">
                <div className="glass-panel p-8 rounded-3xl border border-ghi-blue/10 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-ghi-teal/5 blur-3xl rounded-full -mr-12 -mt-12"></div>
                    <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] mb-6 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-ghi-teal shadow-[0_0_8px_#00F2FF]"></span>
                        Intelligence Focus
                    </h4>
                    <h3 className="text-2xl font-black text-white mb-2 uppercase tracking-wider">Ebola Virus Disease</h3>
                    <p className="text-ghi-teal font-black text-xs uppercase tracking-widest mb-6 neon-text">DRC // North Kivu</p>

                    <div className="space-y-4 py-6 border-y border-white/5 mb-6">
                        <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest">
                            <span className="text-slate-500">Signal ID</span>
                            <span className="text-white">EVT-2026-001</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest">
                            <span className="text-slate-500">Bio-Risk Index</span>
                            <span className="text-ghi-critical neon-text">Severe</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest">
                            <span className="text-slate-500">Fatality Projection</span>
                            <span className="text-white">41.7%</span>
                        </div>
                    </div>

                    <p className="text-slate-400 text-[11px] italic leading-relaxed font-medium">
                        "Event detected via neural mesh sync. Multi-vector transmission suspected in urban zones. Triage phase concluded."
                    </p>
                </div>

                <div className="glass-panel p-8 rounded-3xl border border-ghi-blue/10">
                    <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] mb-4">Assessment Logic</h4>
                    <p className="text-[11px] text-slate-400 leading-relaxed font-medium">
                        Executing IHR (2005) Annex 2 Decision Matrix. Determine if event classification meets <span className="text-ghi-teal font-black">PHEIC</span> status.
                    </p>
                </div>
            </div>

            {/* Main: IHR Form */}
            <div className="lg:col-span-2 glass-panel p-10 rounded-[2.5rem] border border-ghi-blue/10 min-h-[600px] relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-ghi-teal/30 to-transparent"></div>

                <h3 className="text-xl font-black text-white mb-10 flex items-center gap-4 tracking-widest uppercase">
                    <div className="p-3 bg-ghi-teal/10 rounded-2xl text-ghi-teal border border-ghi-teal/20 shadow-[0_0_15px_rgba(0,242,255,0.1)]">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    Annex 2 Analytic Matrix
                </h3>

                <div className="space-y-6">
                    {[
                        { id: 'q1', text: 'Is the public health impact of the event serious?' },
                        { id: 'q2', text: 'Is the event unusual or unexpected?' },
                        { id: 'q3', text: 'Is there a significant risk of international spread?' },
                        { id: 'q4', text: 'Is there a significant risk of international travel or trade restrictions?' },
                    ].map((q, i) => (
                        <div key={q.id} className="p-6 bg-white/[0.02] rounded-2xl border border-white/5 transition-all hover:bg-white/[0.05] group">
                            <div className="flex justify-between items-center gap-6">
                                <div className="flex gap-6 items-center">
                                    <span className="text-ghi-teal/30 font-black text-xl italic group-hover:text-ghi-teal/60 transition-colors tracking-tighter">0{i + 1}</span>
                                    <p className="text-xs font-black text-slate-300 uppercase tracking-widest leading-relaxed">{q.text}</p>
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => handleAnswer(q.id, true)}
                                        className={`px-6 py-2 rounded-xl text-[10px] font-black tracking-widest transition-all uppercase border border-white/5 ${(answers as any)[q.id] === true
                                            ? 'bg-ghi-critical/10 text-ghi-critical border-ghi-critical/30 shadow-[0_0_15px_rgba(255,49,49,0.2)]'
                                            : 'bg-white/5 text-slate-500 hover:text-white hover:border-white/20'
                                            }`}
                                    >YES</button>
                                    <button
                                        onClick={() => handleAnswer(q.id, false)}
                                        className={`px-6 py-2 rounded-xl text-[10px] font-black tracking-widest transition-all uppercase border border-white/5 ${(answers as any)[q.id] === false
                                            ? 'bg-ghi-teal/10 text-ghi-teal border-ghi-teal/30 shadow-[0_0_15px_rgba(0,242,255,0.2)]'
                                            : 'bg-white/5 text-slate-500 hover:text-white hover:border-white/20'
                                            }`}
                                    >NO</button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {isComplete && (
                    <div className={`mt-12 p-8 rounded-3xl border animate-in zoom-in-95 duration-500 ${yesCount >= 2 ? 'bg-ghi-critical/5 border-ghi-critical/20' : 'bg-ghi-teal/5 border-ghi-teal/20'}`}>
                        <div className="flex items-center gap-6 mb-6">
                            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-2xl shadow-lg ${yesCount >= 2 ? 'bg-ghi-critical text-white shadow-ghi-critical/20' : 'bg-ghi-teal text-white shadow-ghi-teal/20'}`}>
                                {yesCount}
                            </div>
                            <div>
                                <h4 className="font-black text-white uppercase tracking-[0.3em] text-[10px] mb-1">Inferred Classification</h4>
                                <p className={`text-sm font-black tracking-widest uppercase ${yesCount >= 2 ? 'text-ghi-critical neon-text' : 'text-ghi-teal neon-text'}`}>
                                    {yesCount >= 2 ? 'MANDATORY WHO NOTIFICATION' : 'LOCAL MONITORING ASSIGNED'}
                                </p>
                            </div>
                        </div>
                        <p className="text-slate-500 text-[11px] font-medium leading-relaxed mb-8 uppercase tracking-widest border-l-2 border-white/10 pl-4">
                            {yesCount >= 2
                                ? 'Neural consensus reached: Event meets IHR notification thresholds. Immediate escalation to GHIC Director required.'
                                : 'Threshold not achieved. Maintain passive surveillance and archive intelligence record.'
                            }
                        </p>
                        <div className="flex gap-4">
                            <button className="flex-1 py-4 bg-white/5 hover:bg-white/10 text-slate-400 font-black text-[10px] rounded-2xl transition-all border border-white/5 uppercase tracking-[0.2em]">
                                SAVE DRAFT
                            </button>
                            <button className={`flex-1 py-4 font-black text-[10px] rounded-2xl transition-all uppercase tracking-[0.2em] shadow-xl ${yesCount >= 2
                                ? 'bg-ghi-critical/20 hover:bg-ghi-critical/30 text-ghi-critical border border-ghi-critical/40'
                                : 'bg-ghi-teal/20 hover:bg-ghi-teal/30 text-ghi-teal border border-ghi-teal/40'
                                }`}>
                                {yesCount >= 2 ? 'ESCALATE TO DIRECTOR' : 'ARCHIVE COMMAND'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AssessmentView;
