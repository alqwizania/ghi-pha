import { useState, useEffect } from 'react';
import { fetchAssessments, updateAssessment, escalateAssessment } from '../lib/api';

const AssessmentView = ({ user }: any) => {
    const [assessments, setAssessments] = useState<any[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // Form state
    const [ihrAnswers, setIhrAnswers] = useState<any>({ q1: null, q2: null, q3: null, q4: null });
    const [rraData, setRraData] = useState<any>({ hazard: '', exposure: '', context: '', riskLevel: 'Low' });

    const loadData = () => {
        setLoading(true);
        fetchAssessments()
            .then(data => {
                setAssessments(data.filter((a: any) => a.status === 'Draft' || a.status === 'Under Assessment'));
                if (data.length > 0 && !selectedId) {
                    selectAssessment(data[0]);
                }
            })
            .finally(() => setLoading(false));
    };

    const selectAssessment = (a: any) => {
        setSelectedId(a.id);
        setIhrAnswers({
            q1: a.ihrQuestion1,
            q2: a.ihrQuestion2,
            q3: a.ihrQuestion3,
            q4: a.ihrQuestion4
        });
        setRraData({
            hazard: a.rraHazardAssessment || '',
            exposure: a.rraExposureAssessment || '',
            context: a.rraContext_assessment || '',
            riskLevel: a.rraOverallRisk || 'Low'
        });
    };

    useEffect(() => {
        loadData();
    }, []);

    const handleIhr = (q: string, val: boolean) => setIhrAnswers({ ...ihrAnswers, [q]: val });

    const handleSave = async (isEscalation = false) => {
        if (!selectedId) return;
        setIsSaving(true);
        try {
            const payload = { ...ihrAnswers, ...rraData };
            await updateAssessment(selectedId, payload);
            if (isEscalation) {
                await escalateAssessment(selectedId, { reason: 'Strategic threshold met', priority: rraData.riskLevel === 'Critical' ? 'Critical' : 'High', userId: user.id });
                loadData();
                setSelectedId(null);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setIsSaving(false);
        }
    };

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <div className="text-ghi-teal font-black animate-pulse uppercase tracking-[0.3em]">Downloading Intelligence Pack...</div>
        </div>
    );

    const activeA = assessments.find(a => a.id === selectedId);
    if (!activeA && assessments.length > 0) return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {assessments.map(a => (
                <button key={a.id} onClick={() => selectAssessment(a)} className="glass-panel p-6 text-left hover:border-ghi-teal/30 transition-all group">
                    <p className="text-[10px] font-black text-ghi-teal uppercase mb-2">Signal ID: {a.signal.id.slice(0, 8)}</p>
                    <h3 className="text-white font-black uppercase tracking-wider mb-4">{a.signal.disease}</h3>
                    <p className="text-slate-500 text-[9px] uppercase font-black">Status: {a.status}</p>
                </button>
            ))}
        </div>
    );

    if (!activeA) return (
        <div className="text-center py-20 glass-panel rounded-[2.5rem] border border-white/5">
            <p className="text-slate-500 font-black text-xs uppercase tracking-[0.3em]">Queue Empty // No assessments required</p>
        </div>
    );

    const yesCount = Object.values(ihrAnswers).filter(v => v === true).length;
    const canEscalate = user?.permissions?.assessment !== 'view' || user?.role === 'Admin';

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 text-slate-100 animate-in fade-in slide-in-from-right-4 duration-1000">
            {/* Left: Signal Summary */}
            <div className="lg:col-span-3 space-y-6">
                <button onClick={() => setSelectedId(null)} className="flex items-center gap-2 text-[9px] font-black text-slate-500 hover:text-ghi-teal transition-colors uppercase tracking-widest mb-4">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
                    Back to Queue
                </button>

                <div className="glass-panel p-6 rounded-3xl border border-ghi-blue/10 bg-ghi-teal/[0.02]">
                    <h4 className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-4">Active Signal</h4>
                    <h3 className="text-xl font-black text-white mb-1 uppercase">{activeA.signal.disease}</h3>
                    <p className="text-ghi-teal font-black text-[10px] uppercase tracking-widest mb-4">{activeA.signal.country}</p>
                    <p className="text-slate-400 text-[10px] leading-relaxed italic">"{activeA.signal.description.slice(0, 100)}..."</p>
                </div>

                <div className="glass-panel p-6 rounded-3xl border border-ghi-blue/10">
                    <h4 className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-6">Risk Calibration</h4>
                    <div className="space-y-4">
                        {['Low', 'Moderate', 'High', 'Critical'].map(level => (
                            <button
                                key={level}
                                onClick={() => setRraData({ ...rraData, riskLevel: level })}
                                className={`w-full py-2 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all ${rraData.riskLevel === level
                                    ? (level === 'Critical' ? 'bg-ghi-critical text-white border-ghi-critical shadow-[0_0_15px_rgba(255,49,49,0.3)]' : 'bg-ghi-teal text-ghi-navy border-ghi-teal')
                                    : 'bg-white/5 text-slate-500 border-white/5 hover:border-white/20'}`}
                            >
                                {level}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Middle: Analytic Tools */}
            <div className="lg:col-span-9 space-y-8">
                <div className="glass-panel p-8 rounded-[2.5rem] border border-ghi-blue/10 relative">
                    <h3 className="text-[11px] font-black text-white mb-8 flex items-center gap-3 uppercase tracking-[0.2em]">
                        <div className="w-1.5 h-1.5 rounded-full bg-ghi-teal shadow-[0_0_8px_#00F2FF]"></div>
                        Tool 01: IHR Annex 2 Matrix
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[
                            { id: 'q1', text: 'Public health impact serious?' },
                            { id: 'q2', text: 'Event unusual or unexpected?' },
                            { id: 'q3', text: 'Significant risk of intl spread?' },
                            { id: 'q4', text: 'Risk of travel/trade restrictions?' },
                        ].map((q) => (
                            <div key={q.id} className="p-4 bg-white/[0.02] rounded-2xl border border-white/5 flex justify-between items-center">
                                <p className="text-[10px] font-black text-slate-400 uppercase max-w-[150px] leading-tight">{q.text}</p>
                                <div className="flex gap-2">
                                    <button onClick={() => handleIhr(q.id, true)} className={`w-10 h-8 rounded-lg text-[9px] font-black border transition-all ${ihrAnswers[q.id] === true ? 'bg-ghi-critical/20 text-ghi-critical border-ghi-critical/50' : 'bg-white/5 text-slate-600 border-white/5'}`}>YES</button>
                                    <button onClick={() => handleIhr(q.id, false)} className={`w-10 h-8 rounded-lg text-[9px] font-black border transition-all ${ihrAnswers[q.id] === false ? 'bg-ghi-teal/20 text-ghi-teal border-ghi-teal/50' : 'bg-white/5 text-slate-600 border-white/5'}`}>NO</button>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="mt-6 flex items-center gap-4 p-4 rounded-2xl bg-white/[0.01] border border-dashed border-white/10">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs ${yesCount >= 2 ? 'bg-ghi-critical/20 text-ghi-critical' : 'bg-ghi-teal/20 text-ghi-teal'}`}>{yesCount}</div>
                        <p className="text-[9px] font-black uppercase text-slate-500 tracking-widest">
                            {yesCount >= 2 ? 'Threshold met for mandatory notification' : 'Signals do not meet notification criteria'}
                        </p>
                    </div>
                </div>

                <div className="glass-panel p-8 rounded-[2.5rem] border border-ghi-blue/10">
                    <h3 className="text-[11px] font-black text-white mb-8 flex items-center gap-3 uppercase tracking-[0.2em]">
                        <div className="w-1.5 h-1.5 rounded-full bg-ghi-warning shadow-[0_0_8px_#FFD700]"></div>
                        Tool 02: Rapid Risk Assessment (RRA)
                    </h3>

                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-[8px] font-black text-slate-500 uppercase tracking-widest ml-2">Hazard Assessment</label>
                                <textarea
                                    value={rraData.hazard}
                                    onChange={e => setRraData({ ...rraData, hazard: e.target.value })}
                                    placeholder="Enter biological hazard details..."
                                    className="w-full h-32 bg-white/[0.02] border border-white/10 rounded-2xl p-4 text-[11px] text-white outline-none focus:ring-1 ring-ghi-teal transition-all placeholder:text-slate-800"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[8px] font-black text-slate-500 uppercase tracking-widest ml-2">Exposure Assessment</label>
                                <textarea
                                    value={rraData.exposure}
                                    onChange={e => setRraData({ ...rraData, exposure: e.target.value })}
                                    placeholder="Enter population exposure analysis..."
                                    className="w-full h-32 bg-white/[0.02] border border-white/10 rounded-2xl p-4 text-[11px] text-white outline-none focus:ring-1 ring-ghi-teal transition-all placeholder:text-slate-800"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[8px] font-black text-slate-500 uppercase tracking-widest ml-2">Contextual Factors</label>
                            <textarea
                                value={rraData.context}
                                onChange={e => setRraData({ ...rraData, context: e.target.value })}
                                placeholder="Enter health systems capacity, geography, etc."
                                className="w-full h-24 bg-white/[0.02] border border-white/10 rounded-2xl p-4 text-[11px] text-white outline-none focus:ring-1 ring-ghi-teal transition-all placeholder:text-slate-800"
                            />
                        </div>
                    </div>
                </div>

                <div className="flex gap-4">
                    <button
                        onClick={() => handleSave(false)}
                        disabled={isSaving}
                        className="flex-1 py-5 bg-white/5 hover:bg-white/10 text-slate-400 font-black text-[11px] rounded-2xl transition-all border border-white/10 uppercase tracking-[0.3em] backdrop-blur-md"
                    >
                        {isSaving ? 'Synchronizing...' : 'Save Intel Draft'}
                    </button>
                    <button
                        onClick={() => handleSave(true)}
                        disabled={isSaving || !canEscalate}
                        className={`flex-1 py-5 font-black text-[11px] rounded-2xl transition-all uppercase tracking-[0.3em] shadow-2xl border ${rraData.riskLevel === 'Critical' || yesCount >= 2
                            ? 'bg-ghi-critical/20 text-ghi-critical border-ghi-critical/50 hover:bg-ghi-critical/30'
                            : 'bg-ghi-teal/10 text-ghi-teal border-ghi-teal/30 hover:bg-ghi-teal/20'}`}
                    >
                        {isSaving ? 'ESCALATING...' : 'Escalate to Director'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AssessmentView;
