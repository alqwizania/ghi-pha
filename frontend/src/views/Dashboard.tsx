import { useState, useEffect, useMemo } from 'react';
import {
  fetchSignals, fetchAssessments, fetchRadarEvents,
  fetchEscalations, fetchSocialSignals, fetchRadarSources,
} from '../lib/api';
import { ASSESSMENT_STATUS, isOpenAssessment } from '../lib/pipeline';
import { Activity, ShieldAlert, Globe, Clock, CheckCircle2, TrendingUp, Layers, BarChart3 } from 'lucide-react';

export default function Dashboard() {
  const [signals, setSignals] = useState<any[]>([]);
  const [assessments, setAssessments] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [escalations, setEscalations] = useState<any[]>([]);
  const [social, setSocial] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);

  useEffect(() => {
    // allSettled, not all: one failing endpoint should not blank the whole
    // executive view. Each panel renders its own empty state.
    Promise.allSettled([
      fetchSignals(), fetchAssessments(), fetchRadarEvents(),
      fetchEscalations(), fetchSocialSignals(), fetchRadarSources(),
    ]).then(([s, a, e, esc, soc, src]) => {
      if (s.status === 'fulfilled' && s.value) setSignals(s.value);
      if (a.status === 'fulfilled' && a.value) setAssessments(a.value);
      if (e.status === 'fulfilled' && e.value) setEvents(e.value);
      if (esc.status === 'fulfilled' && esc.value) setEscalations(esc.value);
      if (soc.status === 'fulfilled' && soc.value) setSocial(soc.value);
      if (src.status === 'fulfilled' && src.value) {
        setSources(Array.isArray(src.value) ? src.value : src.value.sources ?? []);
      }
    });
  }, []);

  // GCC members plus the states sharing a border or corridor with the Kingdom.
  const REGIONAL = [
    'Saudi Arabia', 'United Arab Emirates', 'UAE', 'Qatar', 'Bahrain', 'Kuwait', 'Oman',
    'Yemen', 'Iraq', 'Jordan', 'Egypt', 'Sudan', 'Syria', 'Iran',
  ];

  const TIER_RANK: Record<string, number> = { critical: 3, high: 2, moderate: 1, routine: 0 };

  const stats = useMemo(() => {
    const pendingTriage = signals.filter(s => s.triageStatus === 'Pending Triage' || !s.triageStatus).length;
    // Shared vocabulary — this used to match 'Under Review', a status the
    // backend never writes, while the Assessment view matched 'Under
    // Assessment'. The two screens disagreed about the same rows.
    const activeAssessments = assessments.filter(isOpenAssessment).length;
    const escalated = assessments.filter(a => a.status === ASSESSMENT_STATUS.escalated).length;
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

    // Are the system's eyes open? An executive view that reports zero threats
    // looks identical whether the world is quiet or the collectors are down,
    // and that is the single most dangerous ambiguity in a surveillance
    // dashboard. Source health resolves it.
    const live = sources.filter((s: any) => s.health === 'live' || s.lastStatus === 'ok').length;
    const down = sources.filter((s: any) =>
      ['down', 'http_error', 'network_error', 'parse_error'].includes(s.health ?? s.lastStatus)).length;
    const blocked = sources.filter((s: any) => (s.health ?? s.lastStatus) === 'disabled').length;

    // How long the oldest untriaged signal has been waiting. A queue that is
    // growing is an operational fact an executive needs before it becomes an
    // incident, and a count alone never shows it.
    const pending = signals.filter(s => s.triageStatus === 'Pending Triage' || !s.triageStatus);
    const oldestPending = pending.reduce((oldest: number, s: any) => {
      const t = new Date(s.createdAt || s.dateReported || Date.now()).getTime();
      return Math.min(oldest, t);
    }, Date.now());
    const oldestPendingDays = Math.floor((Date.now() - oldestPending) / 86400000);

    // The statutory line. IHR Article 6 gives 24 hours from assessment, so
    // "how many reached the threshold" is the obligation, not a statistic.
    const notifiable = assessments.filter(a => a.ihrDecision === 'Notify WHO');
    const notifiableUnreviewed = notifiable.filter(a => !a.humanReviewedAt).length;

    const openEscalations = escalations.filter((e: any) =>
      (e.directorStatus ?? 'Pending Review') !== 'Closed' && !e.resolvedAt);

    // What is active, ranked by evidence rather than by summed case counts.
    //
    // Summing cases across sources is not defensible here: WHO's MERS figure is
    // cumulative since 2012, UKHSA's is a 7-day count, GPEI's is year-to-date.
    // Adding them produces a real-looking number with no shared denominator —
    // the same mistake that made MERS score Critical.
    //
    // Ranked instead on how much independent reporting each disease has
    // attracted and how severely it scored, which is what event-based
    // surveillance actually measures. Counts appear per event, never totalled.
    const byDisease = new Map<string, {
      disease: string; countries: Set<string>; sources: Set<string>;
      events: number; topTier: string; maxCases: number; maxDeaths: number;
    }>();

    for (const e of scored) {
      if (!e.score?.reportsOccurrence) continue;
      const key = (e.disease || 'Unspecified').toLowerCase();
      let d = byDisease.get(key);
      if (!d) {
        d = {
          disease: e.disease || 'Unspecified', countries: new Set(), sources: new Set(),
          events: 0, topTier: 'routine', maxCases: 0, maxDeaths: 0,
        };
        byDisease.set(key, d);
      }
      d.events++;
      if (e.country) d.countries.add(e.country);
      if (e.sourceId) d.sources.add(e.sourceId);
      if ((TIER_RANK[e.score.tier] ?? 0) > (TIER_RANK[d.topTier] ?? 0)) d.topTier = e.score.tier;
      d.maxCases = Math.max(d.maxCases, e.cases ?? 0);
      d.maxDeaths = Math.max(d.maxDeaths, e.deaths ?? 0);
    }

    const activeDiseases = [...byDisease.values()]
      .sort((a, b) =>
        (TIER_RANK[b.topTier] ?? 0) - (TIER_RANK[a.topTier] ?? 0) ||
        b.sources.size - a.sources.size ||
        b.countries.size - a.countries.size)
      .slice(0, 6);

    return {
      total: events.length,
      pendingTriage,
      activeAssessments,
      escalated,
      criticalCount,
      autoPromoted,
      regionalThreats,
      regionalCount: regionalThreats.length,
      live, down, blocked, sourceTotal: sources.length,
      oldestPendingDays,
      notifiable: notifiable.length,
      notifiableUnreviewed,
      openEscalations,
      socialToday: social.filter((p: any) =>
        Date.now() - new Date(p.postedAt || p.createdAt || 0).getTime() < 86400000).length,
      socialHigh: social.filter((p: any) => Number(p.relevanceScore ?? 0) >= 60).length,
      activeDiseases,
    };
  }, [signals, assessments, events, escalations, social, sources]);

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
              <h3 className="text-sm font-black text-white uppercase tracking-wider">Active Disease Signals</h3>
            </div>

            {/*
              Was "Priority Disease Burden" with three hardcoded diseases —
              Cholera 420 cases at an 85% bar, and so on. The numbers were
              invented and the bar widths chosen to look right, which made it
              the most misleading panel on the page: Cholera in Yemen is a real
              signal here, so nobody reading "420 cases" had reason to doubt it.

              Ranking by summed cases would not have fixed it. WHO's MERS figure
              is cumulative since 2012, UKHSA's is a 7-day count, GPEI's is
              year-to-date; adding them gives a real-looking number with no
              shared denominator. This ranks on independent reporting and
              severity instead, and shows counts per event rather than totalled.
            */}
            {stats.activeDiseases.length === 0 ? (
              <p className="text-[11px] text-slate-500">
                No diseases with reported occurrences in the current window.
              </p>
            ) : (
              <div className="space-y-3">
                {stats.activeDiseases.map((d: any) => {
                  const colour = d.topTier === 'critical' ? 'bg-ghi-critical'
                    : d.topTier === 'high' ? 'bg-ghi-warning' : 'bg-ghi-teal';
                  const text = d.topTier === 'critical' ? 'text-ghi-critical'
                    : d.topTier === 'high' ? 'text-ghi-warning' : 'text-ghi-teal';
                  // Bar length is corroboration — how many independent sources
                  // report it — which is a quantity that can honestly be
                  // compared across diseases. Four sources fills the bar.
                  const width = Math.min(100, (d.sources.size / 4) * 100);
                  return (
                    <div key={d.disease}>
                      <div className="flex justify-between items-baseline text-xs font-bold mb-1 gap-3">
                        <span className="text-white truncate">{d.disease}</span>
                        <span className={`${text} shrink-0 tabular-nums text-[10px]`}>
                          {d.sources.size} source{d.sources.size === 1 ? '' : 's'}
                          {d.countries.size > 1 ? ` · ${d.countries.size} countries` : ''}
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
                        <div className={`h-full ${colour} rounded-full transition-all`} style={{ width: `${width}%` }}></div>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1 tabular-nums">
                        {d.events} event{d.events === 1 ? '' : 's'}
                        {d.maxCases > 0 && ` · largest report ${d.maxCases} cases`}
                        {d.maxDeaths > 0 && `, ${d.maxDeaths} deaths`}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Was a hardcoded "SOP Compliance Notice" asserting that all signals
              were verified within 24 hours — a compliance claim nothing in the
              system measured. Replaced with collection health, which is the
              fact this space should carry: a dashboard reporting zero threats
              looks the same whether the world is quiet or the collectors are
              down, and that ambiguity is the dangerous one. */}
          <div className={`p-4 rounded-xl border text-xs space-y-2 ${stats.down > 0 ? 'bg-ghi-warning/10 border-ghi-warning/25' : 'bg-ghi-teal/10 border-ghi-teal/20'}`}>
            <div className={`flex items-center gap-2 font-black uppercase ${stats.down > 0 ? 'text-ghi-warning' : 'text-ghi-teal'}`}>
              <CheckCircle2 className="w-4 h-4" /> Collection Health
            </div>
            <p className="text-slate-300 leading-relaxed font-medium">
              <span className="tabular-nums font-black text-white">{stats.live}</span> of{' '}
              <span className="tabular-nums">{stats.sourceTotal}</span> sources collecting
              {stats.down > 0 && <> · <span className="text-ghi-warning font-black tabular-nums">{stats.down}</span> failing</>}
              {stats.blocked > 0 && <> · <span className="tabular-nums">{stats.blocked}</span> awaiting browser rendering</>}
            </p>
            {stats.oldestPendingDays > 2 && (
              <p className="text-[11px] text-ghi-warning/90 font-bold">
                Oldest untriaged signal has waited {stats.oldestPendingDays} days.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Escalations are deliberately not a separate view. They are rare and
          urgent — a tab would hide them until someone thought to look, which is
          the opposite of what an escalation is for. This band appears only when
          one is open, so an executive opening the dashboard cannot miss it. */}
      {(stats.openEscalations.length > 0 || stats.escalated > 0) && (
        <div className="rounded-2xl border border-ghi-critical/50 bg-ghi-critical/10 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-6 h-6 text-ghi-critical shrink-0" />
            <div>
              <p className="text-sm font-black text-white uppercase tracking-wider">
                {stats.openEscalations.length || stats.escalated} Active Escalation
                {(stats.openEscalations.length || stats.escalated) === 1 ? '' : 's'}
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

          {/* The escalations themselves, not just a count. A director opening
              this needs to know what was escalated, how urgent, and why —
              a number tells them only that they are behind. */}
          {stats.openEscalations.length > 0 && (
            <div className="border-t border-ghi-critical/25 pt-3 space-y-2">
              {stats.openEscalations.slice(0, 5).map((e: any) => (
                <div key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px]">
                  <span className={`font-black uppercase tracking-widest px-2 py-0.5 rounded ${e.priority === 'Critical' ? 'bg-ghi-critical/25 text-ghi-critical' : 'bg-ghi-warning/20 text-ghi-warning'}`}>
                    {e.priority}
                  </span>
                  <span className="font-black text-white">
                    {e.signal?.disease ?? 'Signal'}{e.signal?.country ? ` — ${e.signal.country}` : ''}
                  </span>
                  <span className="text-slate-400 flex-1 min-w-[200px]">{e.escalationReason}</span>
                  <span className="text-slate-500 tabular-nums">
                    {e.directorStatus ?? 'Pending Review'}
                    {e.escalatedAt ? ` · ${new Date(e.escalatedAt).toLocaleDateString()}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Statutory position. IHR Article 6 gives 24 hours from assessment, so
          the count that has met the threshold is an obligation rather than a
          statistic — and the ones nobody has reviewed yet are the exposure. */}
      {stats.notifiable > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">IHR Annex 2 Position</p>
            <p className="text-[11px] text-slate-400 mt-1">Assessments whose answers meet the notification threshold.</p>
          </div>
          <div className="flex items-center gap-8 ml-auto">
            <div>
              <p className="text-2xl font-black text-white tabular-nums">{stats.notifiable}</p>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Notifiable</p>
            </div>
            <div>
              <p className={`text-2xl font-black tabular-nums ${stats.notifiableUnreviewed > 0 ? 'text-ghi-warning' : 'text-white'}`}>
                {stats.notifiableUnreviewed}
              </p>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Unreviewed</p>
            </div>
            <div>
              <p className="text-2xl font-black text-ghi-teal tabular-nums">{stats.socialToday}</p>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Listener 24h</p>
            </div>
          </div>
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
