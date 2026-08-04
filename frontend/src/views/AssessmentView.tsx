import { useState, useEffect } from 'react';
import { fetchAssessments, updateAssessment, escalateAssessment } from '../lib/api';
import { isOpenAssessment, RISK_TIERS } from '../lib/pipeline';

const IHR_QUESTIONS = [
    { id: 'q1', notes: 'q1Notes', text: 'Public health impact serious?' },
    { id: 'q2', notes: 'q2Notes', text: 'Event unusual or unexpected?' },
    { id: 'q3', notes: 'q3Notes', text: 'Significant risk of intl spread?' },
    { id: 'q4', notes: 'q4Notes', text: 'Risk of travel/trade restrictions?' },
] as const;

/**
 * Mirrors the backend rule in assessment-drafter.ts. IHR Annex 2 requires
 * notification when any two of the four questions are answered yes, and the
 * always-notifiable list applies regardless of how they are answered.
 */
const decisionFor = (yesCount: number, mandatory: boolean) => {
    if (mandatory || yesCount >= 2) return 'Notify WHO';
    if (yesCount === 1) return 'Monitor and reassess';
    return 'No notification indicated';
};

const AssessmentView = ({ user }: any) => {
    const [assessments, setAssessments] = useState<any[]>([]);
    // Escalated and completed records stay reachable: the queue is the working
    // list, but an analyst still needs to look up what was decided and when.
    const [allAssessments, setAllAssessments] = useState<any[]>([]);
    const [showAll, setShowAll] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // Form state — these are the *live* values. The machine draft is read-only
    // and lives on the assessment record; the gap between the two is the record
    // of where the analyst disagreed.
    const [ihrAnswers, setIhrAnswers] = useState<any>({ q1: null, q2: null, q3: null, q4: null });
    const [ihrNotes, setIhrNotes] = useState<any>({ q1Notes: '', q2Notes: '', q3Notes: '', q4Notes: '' });
    const [rraData, setRraData] = useState<any>({ hazard: '', exposure: '', context: '', riskLevel: 'Low', confidenceLevel: 'Medium' });

    const loadData = () => {
        setLoading(true);
        fetchAssessments()
            .then(data => {
                // The view opens on the queue, never on an assessment. Auto-
                // selecting the first one meant an analyst arriving at the tab
                // was already inside a case they had not chosen, with no sense
                // of how many were waiting or which mattered most — and any
                // edit they began was against whichever record happened to
                // sort first.
                setAssessments(data.filter(isOpenAssessment));
                setAllAssessments(data);
            })
            .finally(() => setLoading(false));
    };

    const selectAssessment = (a: any) => {
        setSelectedId(a.id);
        setIhrAnswers({ q1: a.ihrQuestion1, q2: a.ihrQuestion2, q3: a.ihrQuestion3, q4: a.ihrQuestion4 });
        setIhrNotes({
            q1Notes: a.ihrQuestion1Notes || '',
            q2Notes: a.ihrQuestion2Notes || '',
            q3Notes: a.ihrQuestion3Notes || '',
            q4Notes: a.ihrQuestion4Notes || '',
        });
        setRraData({
            hazard: a.rraHazardAssessment || '',
            exposure: a.rraExposureAssessment || '',
            context: a.rraContext_assessment || '',
            riskLevel: a.rraOverallRisk || 'Low',
            confidenceLevel: a.rraConfidenceLevel || 'Medium',
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
            const yes = Object.values(ihrAnswers).filter(v => v === true).length;
            const mandatory = Boolean(assessments.find(a => a.id === selectedId)?.machineDraft?.ihr?.mandatoryIhr);
            const payload = { ...ihrAnswers, ...ihrNotes, ...rraData, ihrDecision: decisionFor(yes, mandatory) };
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

    // The queue. A line listing rather than cards: this is a worklist an
    // analyst scans down to decide what to open next, and the questions they
    // are asking — what is it, where, how bad, has anyone touched it — are
    // comparisons across rows, which a grid of cards makes harder than a table.
    if (!activeA) {
        const rows = showAll ? allAssessments : assessments;
        return (
            <div className="space-y-6 animate-in fade-in duration-700">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <h2 className="text-sm font-black text-white uppercase tracking-[0.2em]">Assessment Queue</h2>
                        <p className="text-[11px] text-slate-500 mt-1">
                            Signals accepted in triage. Each opens with a machine-drafted IHR Annex 2 answer set and RRA.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowAll(false)}
                            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${!showAll ? 'bg-ghi-teal/15 text-ghi-teal border-ghi-teal/40' : 'bg-white/5 text-slate-500 border-white/5'}`}
                        >
                            Open ({assessments.length})
                        </button>
                        <button
                            onClick={() => setShowAll(true)}
                            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${showAll ? 'bg-ghi-teal/15 text-ghi-teal border-ghi-teal/40' : 'bg-white/5 text-slate-500 border-white/5'}`}
                        >
                            All ({allAssessments.length})
                        </button>
                    </div>
                </div>

                {rows.length === 0 ? (
                    <div className="text-center py-20 glass-panel rounded-[2.5rem] border border-white/5">
                        <p className="text-slate-500 font-black text-xs uppercase tracking-[0.3em] mb-2">Queue Empty</p>
                        <p className="text-[11px] text-slate-600">Accepting a signal in Triage opens an assessment here.</p>
                    </div>
                ) : (
                    <div className="glass-panel rounded-[2rem] border border-ghi-blue/10 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse min-w-[840px]">
                                <thead>
                                    <tr className="border-b border-white/5 bg-white/[0.02]">
                                        {['Disease', 'Country', 'Reported', 'Cases / Deaths', 'IHR', 'Risk', 'Confidence', 'Status'].map(h => (
                                            <th key={h} className="px-5 py-4 text-[9px] font-black text-slate-500 uppercase tracking-[0.15em] whitespace-nowrap">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(a => {
                                        const s = a.signal ?? {};
                                        const risk = a.rraOverallRisk || '—';
                                        const touched = Boolean(a.humanReviewedAt);
                                        return (
                                            <tr
                                                key={a.id}
                                                onClick={() => selectAssessment(a)}
                                                className="border-b border-white/5 last:border-0 hover:bg-ghi-teal/[0.04] cursor-pointer transition-colors"
                                            >
                                                <td className="px-5 py-4">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[12px] font-black text-white">{s.disease || 'Unspecified'}</span>
                                                        {a.machineDraft && !touched && (
                                                            <span className="text-[8px] font-black uppercase tracking-widest text-ghi-warning/70 border border-ghi-warning/25 rounded px-1.5 py-0.5">
                                                                Drafted
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="text-[10px] text-slate-600">{s.sourceName || 'Source not recorded'}</span>
                                                </td>
                                                <td className="px-5 py-4 text-[11px] text-slate-300 whitespace-nowrap">{s.country || '—'}</td>
                                                <td className="px-5 py-4 text-[11px] text-slate-500 whitespace-nowrap tabular-nums">
                                                    {s.dateReported ? String(s.dateReported).slice(0, 10) : '—'}
                                                </td>
                                                <td className="px-5 py-4 text-[11px] text-slate-300 tabular-nums whitespace-nowrap">
                                                    {(s.cases ?? 0) || (s.deaths ?? 0)
                                                        ? `${s.cases ?? 0} / ${s.deaths ?? 0}`
                                                        : <span className="text-slate-600">not stated</span>}
                                                </td>
                                                <td className="px-5 py-4 whitespace-nowrap">
                                                    <span className={`text-[10px] font-black uppercase tracking-wider ${a.ihrDecision === 'Notify WHO' ? 'text-ghi-critical' : 'text-slate-500'}`}>
                                                        {a.ihrDecision || 'Not answered'}
                                                    </span>
                                                </td>
                                                <td className="px-5 py-4 whitespace-nowrap">
                                                    <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border ${risk === 'Critical' ? 'bg-ghi-critical/15 text-ghi-critical border-ghi-critical/40'
                                                        : risk === 'High' ? 'bg-ghi-warning/15 text-ghi-warning border-ghi-warning/40'
                                                            : 'bg-white/5 text-slate-400 border-white/10'}`}>
                                                        {risk}
                                                    </span>
                                                </td>
                                                {/* Risk and confidence stay side by side and separate — a
                                                    Critical rumour and a Critical confirmed outbreak need
                                                    different actions, and one blended number hides which. */}
                                                <td className="px-5 py-4 text-[11px] text-slate-400 whitespace-nowrap">{a.rraConfidenceLevel || '—'}</td>
                                                <td className="px-5 py-4 whitespace-nowrap">
                                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">{a.status}</span>
                                                    <span className="block text-[9px] text-slate-600">
                                                        {touched ? `reviewed ${new Date(a.humanReviewedAt).toLocaleDateString()}` : 'not yet reviewed'}
                                                    </span>
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

    const draft = activeA.machineDraft || null;
    const yesCount = Object.values(ihrAnswers).filter(v => v === true).length;
    const canEscalate = user?.permissions?.assessment !== 'view' || user?.role === 'Admin';
    const liveDecision = decisionFor(yesCount, Boolean(draft?.ihr?.mandatoryIhr));

    // Which answers the analyst has moved away from the machine draft. This is
    // the whole override mechanism — nothing else records it.
    const overrides = draft
        ? IHR_QUESTIONS.filter(q => ihrAnswers[q.id] !== null && ihrAnswers[q.id] !== draft.ihr[q.id])
        : [];

    const revert = (q: typeof IHR_QUESTIONS[number]) => {
        if (!draft) return;
        setIhrAnswers({ ...ihrAnswers, [q.id]: draft.ihr[q.id] });
        setIhrNotes({ ...ihrNotes, [q.notes]: draft.ihr[`${q.id}Notes`] || '' });
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 text-slate-100 animate-in fade-in slide-in-from-right-4 duration-1000">
            {/* Left: Signal Summary */}
            <div className="lg:col-span-3 space-y-6">
                <button onClick={() => setSelectedId(null)} className="flex items-center gap-2 text-[11px] font-black text-slate-500 hover:text-ghi-teal transition-colors uppercase tracking-widest mb-4">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
                    Back to Queue
                </button>

                <div className="glass-panel p-6 rounded-3xl border border-ghi-blue/10 bg-ghi-teal/[0.02]">
                    <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-4">Active Signal</h4>
                    <h3 className="text-xl font-black text-white mb-1 uppercase">{activeA.signal.disease}</h3>
                    <p className="text-ghi-teal font-black text-[11px] uppercase tracking-widest mb-4">{activeA.signal.country}</p>
                    <p className="text-slate-400 text-[11px] leading-relaxed italic">"{(activeA.signal.description || '').slice(0, 100)}..."</p>
                </div>

                <div className="glass-panel p-6 rounded-3xl border border-ghi-blue/10">
                    <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-6">Risk Calibration</h4>
                    <div className="space-y-4">
                        {RISK_TIERS.map(level => (
                            <button
                                key={level}
                                onClick={() => setRraData({ ...rraData, riskLevel: level })}
                                className={`w-full py-2 rounded-xl text-[11px] font-black uppercase tracking-widest border transition-all flex items-center justify-center gap-2 ${rraData.riskLevel === level
                                    ? (level === 'Critical' ? 'bg-ghi-critical text-white border-ghi-critical shadow-[0_0_15px_rgba(255,49,49,0.3)]' : 'bg-ghi-teal text-ghi-navy border-ghi-teal')
                                    : 'bg-white/5 text-slate-500 border-white/5 hover:border-white/20'}`}
                            >
                                {level}
                                {draft?.rra?.overallRisk === level && (
                                    <span className="text-[8px] opacity-60 tracking-normal">draft</span>
                                )}
                            </button>
                        ))}
                    </div>

                    {/* WHO's RRA keeps risk and confidence apart on purpose: a
                        high risk assessed on one unverified report is a different
                        object from the same risk assessed on three. */}
                    <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mt-8 mb-4">Confidence in Assessment</h4>
                    <div className="flex gap-2">
                        {['Low', 'Medium', 'High'].map(level => (
                            <button
                                key={level}
                                onClick={() => setRraData({ ...rraData, confidenceLevel: level })}
                                className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${rraData.confidenceLevel === level
                                    ? 'bg-white/10 text-white border-white/30'
                                    : 'bg-white/5 text-slate-600 border-white/5 hover:border-white/20'}`}
                            >
                                {level}
                            </button>
                        ))}
                    </div>
                </div>

                {!!draft?.rra?.keyUncertainties?.length && (
                    <div className="glass-panel p-6 rounded-3xl border border-ghi-warning/20 bg-ghi-warning/[0.02]">
                        <h4 className="text-[11px] font-black text-ghi-warning/80 uppercase tracking-widest mb-4">Key Uncertainties</h4>
                        <ul className="space-y-3">
                            {draft.rra.keyUncertainties.map((u: string, i: number) => (
                                <li key={i} className="text-[10px] text-slate-400 leading-relaxed flex gap-2">
                                    <span className="text-ghi-warning/50 shrink-0">—</span>{u}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            {/* Middle: Analytic Tools */}
            <div className="lg:col-span-9 space-y-8">
                {draft && (
                    <div className="glass-panel p-6 rounded-[2rem] border border-ghi-teal/20 bg-ghi-teal/[0.03]">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <p className="text-[10px] font-black text-ghi-teal uppercase tracking-[0.2em] mb-2">
                                    Automated First Pass · {draft.drafterVersion} · {draft.scorerVersion}
                                </p>
                                <p className="text-[11px] text-slate-400 leading-relaxed max-w-2xl">
                                    {draft.ihr.decisionRationale}
                                </p>
                            </div>
                            <div className="text-right shrink-0">
                                <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-1">Draft Position</p>
                                <p className="text-sm font-black text-white uppercase">{draft.ihr.decision}</p>
                                <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest mt-1">
                                    {new Date(draft.generatedAt).toLocaleString()}
                                </p>
                            </div>
                        </div>
                        <p className="text-[10px] text-slate-600 mt-4 leading-relaxed border-t border-white/5 pt-4">
                            This draft is frozen. Anything you change below is yours and takes precedence —
                            the original remains on the record for audit.
                            {overrides.length > 0 && (
                                <span className="text-ghi-warning/90 font-black uppercase tracking-widest ml-2">
                                    {overrides.length} of 4 answers overridden
                                </span>
                            )}
                        </p>
                    </div>
                )}

                <div className="glass-panel p-8 rounded-[2.5rem] border border-ghi-blue/10 relative">
                    <h3 className="text-[11px] font-black text-white mb-8 flex items-center gap-3 uppercase tracking-[0.2em]">
                        <div className="w-1.5 h-1.5 rounded-full bg-ghi-teal shadow-[0_0_8px_#00F2FF]"></div>
                        Tool 01: IHR Annex 2 Matrix
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {IHR_QUESTIONS.map((q) => {
                            const overridden = draft && ihrAnswers[q.id] !== null && ihrAnswers[q.id] !== draft.ihr[q.id];
                            return (
                                <div key={q.id} className={`p-4 rounded-2xl border flex flex-col gap-3 transition-colors ${overridden ? 'bg-ghi-warning/[0.04] border-ghi-warning/20' : 'bg-white/[0.02] border-white/5'}`}>
                                    <div className="flex justify-between items-center gap-3">
                                        <p className="text-[11px] font-black text-slate-400 uppercase max-w-[150px] leading-tight">{q.text}</p>
                                        <div className="flex gap-2">
                                            <button onClick={() => handleIhr(q.id, true)} className={`w-10 h-8 rounded-lg text-[10px] font-black border transition-all ${ihrAnswers[q.id] === true ? 'bg-ghi-critical/20 text-ghi-critical border-ghi-critical/50' : 'bg-white/5 text-slate-600 border-white/5'}`}>YES</button>
                                            <button onClick={() => handleIhr(q.id, false)} className={`w-10 h-8 rounded-lg text-[10px] font-black border transition-all ${ihrAnswers[q.id] === false ? 'bg-ghi-teal/20 text-ghi-teal border-ghi-teal/50' : 'bg-white/5 text-slate-600 border-white/5'}`}>NO</button>
                                        </div>
                                    </div>

                                    {draft && (
                                        <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest">
                                            <span className="text-slate-600">Draft said</span>
                                            <span className={draft.ihr[q.id] ? 'text-ghi-critical/70' : 'text-ghi-teal/70'}>
                                                {draft.ihr[q.id] ? 'Yes' : 'No'}
                                            </span>
                                            {overridden && (
                                                <button onClick={() => revert(q)} className="ml-auto text-ghi-warning/80 hover:text-ghi-warning border border-ghi-warning/30 rounded px-2 py-0.5 transition-colors">
                                                    Revert
                                                </button>
                                            )}
                                        </div>
                                    )}

                                    {/* The justification is the part an IHR reviewer reads. It
                                        is prefilled from the draft and edited in place. */}
                                    <textarea
                                        value={ihrNotes[q.notes]}
                                        onChange={e => setIhrNotes({ ...ihrNotes, [q.notes]: e.target.value })}
                                        placeholder="Justification for this answer..."
                                        className="w-full h-20 bg-transparent border border-transparent hover:border-white/10 focus:border-white/20 focus:bg-white/[0.02] rounded-xl p-2 text-[10px] text-slate-400 leading-relaxed outline-none transition-all resize-none placeholder:text-slate-700"
                                    />
                                </div>
                            );
                        })}
                    </div>

                    <div className="mt-6 flex flex-wrap items-center gap-4 p-4 rounded-2xl bg-white/[0.01] border border-dashed border-white/10">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs shrink-0 ${yesCount >= 2 ? 'bg-ghi-critical/20 text-ghi-critical' : 'bg-ghi-teal/20 text-ghi-teal'}`}>{yesCount}</div>
                        <p className="text-[11px] font-black uppercase text-slate-500 tracking-widest">
                            {yesCount >= 2 ? 'Threshold met for mandatory notification' : 'Signals do not meet notification criteria'}
                        </p>
                        <p className="ml-auto text-[11px] font-black uppercase tracking-widest text-white">{liveDecision}</p>
                    </div>

                    {draft?.ihr?.mandatoryIhr && (
                        <p className="mt-3 text-[10px] text-ghi-critical/80 font-black uppercase tracking-widest">
                            Always-notifiable under Annex 2 — the duty applies regardless of the four answers
                        </p>
                    )}
                </div>

                <div className="glass-panel p-8 rounded-[2.5rem] border border-ghi-blue/10">
                    <h3 className="text-[11px] font-black text-white mb-8 flex items-center gap-3 uppercase tracking-[0.2em]">
                        <div className="w-1.5 h-1.5 rounded-full bg-ghi-warning shadow-[0_0_8px_#FFD700]"></div>
                        Tool 02: Rapid Risk Assessment (RRA)
                    </h3>

                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-2">Hazard Assessment</label>
                                <textarea
                                    value={rraData.hazard}
                                    onChange={e => setRraData({ ...rraData, hazard: e.target.value })}
                                    placeholder="Enter biological hazard details..."
                                    className="w-full h-32 bg-white/[0.02] border border-white/10 rounded-2xl p-4 text-[11px] text-white outline-none focus:ring-1 ring-ghi-teal transition-all placeholder:text-slate-800"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-2">Exposure Assessment</label>
                                <textarea
                                    value={rraData.exposure}
                                    onChange={e => setRraData({ ...rraData, exposure: e.target.value })}
                                    placeholder="Enter population exposure analysis..."
                                    className="w-full h-32 bg-white/[0.02] border border-white/10 rounded-2xl p-4 text-[11px] text-white outline-none focus:ring-1 ring-ghi-teal transition-all placeholder:text-slate-800"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-2">Contextual Factors</label>
                            <textarea
                                value={rraData.context}
                                onChange={e => setRraData({ ...rraData, context: e.target.value })}
                                placeholder="Enter health systems capacity, geography, etc."
                                className="w-full h-24 bg-white/[0.02] border border-white/10 rounded-2xl p-4 text-[11px] text-white outline-none focus:ring-1 ring-ghi-teal transition-all placeholder:text-slate-800"
                            />
                        </div>
                    </div>

                    {!!draft?.rra?.recommendations?.length && (
                        <div className="mt-8 pt-6 border-t border-white/5">
                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Drafted Recommended Actions</h4>
                            <ul className="space-y-2">
                                {draft.rra.recommendations.map((r: string, i: number) => (
                                    <li key={i} className="text-[11px] text-slate-400 leading-relaxed flex gap-3">
                                        <span className="text-ghi-teal/50 shrink-0 font-black">{String(i + 1).padStart(2, '0')}</span>{r}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
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
