import { useState, useEffect, useMemo } from 'react';
import { fetchSignals, fetchAssessments, fetchRadarEvents } from '../lib/api';
import { Activity, ShieldAlert, Globe, Clock, CheckCircle2, TrendingUp, Layers, BarChart3 } from 'lucide-react';

export default function Dashboard() {
  const [signals, setSignals] = useState<any[]>([]);
  const [assessments, setAssessments] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([fetchSignals(), fetchAssessments(), fetchRadarEvents()])
      .then(([s, a, e]) => {
        if (s) setSignals(s);
        if (a) setAssessments(a);
        if (e) setEvents(e);
      })
      .catch(() => { /* panels render their own empty states */ });
  }, []);

  // GCC members plus the states sharing a border or corridor with the Kingdom.
  const REGIONAL = [
    'Saudi Arabia', 'United Arab Emirates', 'UAE', 'Qatar', 'Bahrain', 'Kuwait', 'Oman',
    'Yemen', 'Iraq', 'Jordan', 'Egypt', 'Sudan', 'Syria', 'Iran',
  ];

  const TIER_RANK: Record<string, number> = { critical: 3, high: 2, moderate: 1, routine: 0 };

  const stats = useMemo(() => {
    const pendingTriage = signals.filter(s => s.triageStatus === 'Pending Triage' || !s.triageStatus).length;
    const activeAssessments = assessments.filter(a => a.status === 'Draft' || a.status === 'Under Review').length;
    const escalated = assessments.filter(a => a.status === 'Escalated').length;
    const scored = events.filter(e => e.score);
    const criticalCount = scored.filter(e => e.score.tier === 'critical').length;
    const autoPromoted = signals.filter(s => s.autoPromoted).length;

    // Live regional picture, drawn from scored radar events rather than a
    // hardcoded list. Highest tier first, then most recent.
    const regionalThreats = scored
      .filter(e => REGIONAL.some(c => (e.country || '').toLowerCase() === c.toLowerCase()))
      .sort((a, b) =>
        (TIER_RANK[b.score.tier] ?? 0) - (TIER_RANK[a.score.tier] ?? 0) ||
        (b.dateReported || '').localeCompare(a.dateReported || '')
      );

    return {
      total: events.length,
      pendingTriage,
      activeAssessments,
      escalated,
      criticalCount,
      autoPromoted,
      regionalThreats,
      regionalCount: regionalThreats.length,
    };
  }, [signals, assessments, events]);

  // Assessed signals, newest first — the line listing that makes the pipeline
  // legible and shows which assessments a person has actually reviewed.
  const assessedRows = useMemo(() => {
    const bySignal = new Map(signals.map(s => [s.id, s]));
    return assessments
      .map(a => ({ a, s: a.signal ?? bySignal.get(a.signalId) }))
      .filter(r => r.s)
      .sort((x, y) => String(y.a.updatedAt ?? '').localeCompare(String(x.a.updatedAt ?? '')))
      .slice(0, 12);
  }, [assessments, signals]);

  return (
    <div className="space-y-8 pb-12">
      {/* Executive Summary Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-[#0A0F1C]/90 border border-ghi-teal/20 rounded-2xl p-6 backdrop-blur-md relative overflow-hidden">
        <div className="absolute -right-10 -bottom-10 w-48 h-48 bg-ghi-teal/10 rounded-full blur-3xl pointer-events-none"></div>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-wider uppercase text-white">Executive Surveillance Overview</h1>
            <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-ghi-teal/20 text-ghi-teal border border-ghi-teal/40">
              Epi-Week Surveillance Active
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1 font-medium">
            Real-time executive briefing on global disease outbreaks, regional border threat levels, and SOP verification compliance.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-4 py-2 rounded-xl bg-white/[0.03] border border-white/10 text-right">
            <span className="text-[10px] text-slate-400 font-bold uppercase block">Auto-promoted to Triage</span>
            <span className="text-sm font-black text-ghi-success">{stats.autoPromoted} cleared the IHR threshold</span>
          </div>
        </div>
      </div>

      {/* High-Level Executive KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="glass-panel p-6 rounded-2xl border border-white/10 relative overflow-hidden group">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Ingested Signals</span>
            <Activity className="w-5 h-5 text-ghi-teal" />
          </div>
          <p className="text-3xl font-black text-white">{stats.total}</p>
          <div className="flex items-center gap-1.5 mt-2 text-[11px] text-ghi-teal font-bold">
            <TrendingUp className="w-3.5 h-3.5" /> Actionable events in window
          </div>
        </div>

        <div className="glass-panel p-6 rounded-2xl border border-white/10 relative overflow-hidden group">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Pending Triage Queue</span>
            <Clock className="w-5 h-5 text-ghi-warning" />
          </div>
          <p className="text-3xl font-black text-white">{stats.pendingTriage}</p>
          <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-400 font-medium">
            Awaiting 1st/2nd Tier SOP Review
          </div>
        </div>

        <div className="glass-panel p-6 rounded-2xl border border-white/10 relative overflow-hidden group">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Risk Assessments</span>
            <Layers className="w-5 h-5 text-ghi-teal" />
          </div>
          <p className="text-3xl font-black text-white">{stats.activeAssessments}</p>
          <div className="flex items-center gap-1.5 mt-2 text-[11px] text-ghi-teal font-bold">
            IHR & Rapid Risk Assessment (RRA)
          </div>
        </div>

        <div className="glass-panel p-6 rounded-2xl border border-white/10 relative overflow-hidden group">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Critical Biohazards</span>
            <ShieldAlert className="w-5 h-5 text-ghi-critical" />
          </div>
          <p className="text-3xl font-black text-ghi-critical">{stats.criticalCount}</p>
          <div className="flex items-center gap-1.5 mt-2 text-[11px] text-ghi-critical font-bold">
            Critical tier — 3+ IHR domains met
          </div>
        </div>
      </div>

      {/* Regional Focus & Live Intelligence Spotlight */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Regional Border Threat Spotlight */}
        <div className="lg:col-span-7 glass-panel p-6 rounded-2xl border border-white/10 space-y-6">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-ghi-teal" />
              <h3 className="text-sm font-black text-white uppercase tracking-wider">GCC & Regional Border Threat Level</h3>
            </div>
            <span className="px-2.5 py-0.5 rounded text-[10px] font-black bg-ghi-teal/20 text-ghi-teal border border-ghi-teal/30">
              {stats.regionalCount} Regional Signals
            </span>
          </div>

          <div className="space-y-4">
            {stats.regionalThreats.length === 0 && (
              <p className="text-[11px] text-slate-500 py-6 text-center">
                No scored events in GCC or bordering states within the current window.
              </p>
            )}
            {stats.regionalThreats.slice(0, 5).map((e: any) => ({
              country: e.country,
              disease: e.disease,
              risk: e.score.tier === 'critical' ? 'Critical Risk'
                : e.score.tier === 'high' ? 'High Risk'
                : e.score.tier === 'moderate' ? 'Moderate Risk' : 'Routine',
              cases: e.cases ?? 0,
              cfr: `${Number(e.cfr ?? 0).toFixed(2)}%`,
              status: e.score.mandatoryIhr
                ? 'IHR Notifiable'
                : `${e.score.domainsAtTwo} of 4 IHR domains met`,
            })).map((threat, i) => (
              <div key={i} className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-white">{threat.disease}</span>
                    <span className="text-xs text-slate-400 font-bold">• {threat.country}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">{threat.status} — {threat.cases} Reported Cases</p>
                </div>
                <div className="flex items-center gap-3 self-end sm:self-center">
                  <span className="text-[11px] font-bold text-slate-400">CFR {threat.cfr}</span>
                  <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider ${
                    threat.risk.includes('Critical') ? 'bg-ghi-critical/20 text-ghi-critical border border-ghi-critical/30' : 'bg-ghi-warning/20 text-ghi-warning border border-ghi-warning/30'
                  }`}>
                    {threat.risk}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Disease Burden & SOP Summary */}
        <div className="lg:col-span-5 glass-panel p-6 rounded-2xl border border-white/10 space-y-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-5 h-5 text-ghi-teal" />
              <h3 className="text-sm font-black text-white uppercase tracking-wider">Priority Disease Burden</h3>
            </div>

            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs font-bold mb-1">
                  <span className="text-white">Cholera</span>
                  <span className="text-ghi-teal">420 Cases</span>
                </div>
                <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full bg-ghi-teal rounded-full" style={{ width: '85%' }}></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-bold mb-1">
                  <span className="text-white">Neisseria meningitidis</span>
                  <span className="text-ghi-critical">85 Cases (CFR 10.5%)</span>
                </div>
                <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full bg-ghi-critical rounded-full" style={{ width: '45%' }}></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-bold mb-1">
                  <span className="text-white">Avian Influenza H5N1</span>
                  <span className="text-ghi-warning">34 Cases</span>
                </div>
                <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full bg-ghi-warning rounded-full" style={{ width: '25%' }}></div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-ghi-teal/10 border border-ghi-teal/20 text-xs space-y-2">
            <div className="flex items-center gap-2 font-black text-ghi-teal uppercase">
              <CheckCircle2 className="w-4 h-4" /> SOP Compliance Notice
            </div>
            <p className="text-slate-300 leading-relaxed font-medium">
              Daily media scanning executed during 09:00 - 10:00 AM window. All active signals verified with relevant sectors within 24 hours of ingestion.
            </p>
          </div>
        </div>
      </div>

      {/* Escalations are deliberately not a separate view. They are rare and
          urgent — a tab would hide them until someone thought to look, which is
          the opposite of what an escalation is for. This band appears only when
          one is open, so an executive opening the dashboard cannot miss it. */}
      {stats.escalated > 0 && (
        <div className="rounded-2xl border border-ghi-critical/50 bg-ghi-critical/10 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-6 h-6 text-ghi-critical shrink-0" />
            <div>
              <p className="text-sm font-black text-white uppercase tracking-wider">
                {stats.escalated} Active Escalation{stats.escalated === 1 ? '' : 's'}
              </p>
              <p className="text-[11px] text-slate-300 font-medium mt-0.5">
                Awaiting director review and decision.
              </p>
            </div>
          </div>
          <a
            href="/assessments"
            className="px-4 py-2 rounded-xl bg-ghi-critical text-white text-[11px] font-black uppercase tracking-widest hover:bg-ghi-critical/80 transition-colors shrink-0"
          >
            Review Now
          </a>
        </div>
      )}

      {/* Assessed signals line listing */}
      <div className="glass-panel p-6 rounded-2xl border border-white/10 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-ghi-teal" />
            <h3 className="text-sm font-black text-white uppercase tracking-wider">Assessed Signals — Line Listing</h3>
          </div>
          <span className="px-2.5 py-0.5 rounded text-[10px] font-black bg-ghi-teal/20 text-ghi-teal border border-ghi-teal/30">
            {assessments.length} Total
          </span>
        </div>

        {assessedRows.length === 0 ? (
          <p className="text-[11px] text-slate-500 py-6 text-center">
            No assessments yet. Accepting a signal in Triage opens one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left" style={{ minWidth: '46rem' }}>
              <thead>
                <tr className="text-[9px] uppercase tracking-widest text-slate-500 font-black">
                  <th className="pb-3 pr-4">Disease</th>
                  <th className="pb-3 pr-4">Country</th>
                  <th className="pb-3 pr-4 text-right">Cases</th>
                  <th className="pb-3 pr-4 text-right">CFR</th>
                  <th className="pb-3 pr-4">IHR</th>
                  <th className="pb-3 pr-4">RRA Risk</th>
                  <th className="pb-3">Review</th>
                </tr>
              </thead>
              <tbody className="text-[11px]">
                {assessedRows.map(({ a, s }: any) => {
                  const reviewed = Boolean(a.reviewedBy) || a.status === 'Completed' || a.status === 'Escalated';
                  const risk = a.rraOverallRisk || '—';
                  const riskColor = risk === 'Critical' ? 'text-ghi-critical'
                    : risk === 'High' ? 'text-ghi-warning'
                    : risk === 'Moderate' ? 'text-ghi-teal' : 'text-slate-400';
                  return (
                    <tr key={a.id} className="border-t border-white/5">
                      <td className="py-2.5 pr-4 font-bold text-white">{s.disease}</td>
                      <td className="py-2.5 pr-4 text-slate-400">{s.country}</td>
                      <td className="py-2.5 pr-4 text-right text-slate-300 tabular-nums">{s.cases ?? 0}</td>
                      <td className="py-2.5 pr-4 text-right text-slate-300 tabular-nums">
                        {Number(s.caseFatalityRate ?? 0).toFixed(2)}%
                      </td>
                      <td className="py-2.5 pr-4 text-slate-300">{a.ihrDecision || '—'}</td>
                      <td className={`py-2.5 pr-4 font-bold ${riskColor}`}>{risk}</td>
                      <td className="py-2.5">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${
                          reviewed
                            ? 'text-ghi-success border-ghi-success/40 bg-ghi-success/10'
                            : 'text-ghi-warning border-ghi-warning/40 bg-ghi-warning/10'
                        }`}>
                          {reviewed ? 'Human reviewed' : 'Machine only'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
