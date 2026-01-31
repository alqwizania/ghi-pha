
import { useState, useEffect } from 'react';
import { fetchSignals, fetchAssessments, fetchEscalations } from '../lib/api';
import { ComposableMap, Geographies, Geography } from 'react-simple-maps';

const geoUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

interface MetricCardProps {
    label: string;
    value: number;
    trend: string;
    color: 'red' | 'teal';
}

const MetricCard = ({ label, value, trend, color }: MetricCardProps) => (
    <div className="glass-panel p-6 rounded-3xl border border-white/5 hover:border-white/10 transition-all duration-500 group relative overflow-hidden">
        <div className={`absolute top-0 right-0 w-24 h-24 blur-[60px] rounded-full -mr-12 -mt-12 transition-all duration-700 ${color === 'red' ? 'bg-ghi-critical/10 group-hover:bg-ghi-critical/20' : 'bg-ghi-teal/10 group-hover:bg-ghi-teal/20'}`}></div>
        <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.2em] mb-4">{label}</p>
        <div className="flex items-end justify-between relative z-10">
            <h3 className="text-4xl font-black text-white tracking-tighter">{value}</h3>
            <span className={`text-[10px] font-black px-2 py-1 rounded-lg border ${color === 'red' ? 'bg-ghi-critical/5 text-ghi-critical border-ghi-critical/20' : 'bg-ghi-teal/5 text-ghi-teal border-ghi-teal/20'}`}>
                {trend}
            </span>
        </div>
    </div>
);

const Dashboard = () => {
    const [signals, setSignals] = useState<any[]>([]);
    const [assessments, setAssessments] = useState<any[]>([]);
    const [escalations, setEscalations] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([fetchSignals(), fetchAssessments(), fetchEscalations()])
            .then(([s, a, e]) => {
                setSignals(s);
                setAssessments(a);
                setEscalations(e);
            })
            .finally(() => setLoading(false));
    }, []);

    const metrics = {
        total: signals.length,
        pendingTriage: signals.filter(s => s.triageStatus === 'Pending Triage').length,
        pendingAssessment: assessments.filter(a => a.status !== 'Completed').length,
        escalated: escalations.length,
        recent: signals.slice(0, 5)
    };

    const hotZones = Array.from(new Set(signals.map(s => s.country)));

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <div className="text-ghi-teal font-black animate-pulse uppercase tracking-[0.3em]">Calibrating Global Surveillance...</div>
        </div>
    );

    return (
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-1000">
            {/* Metric Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <MetricCard label="Global Signals" value={metrics.total} trend="+12% LVL" color="teal" />
                <MetricCard label="Pending Triage" value={metrics.pendingTriage} trend="Critical" color="red" />
                <MetricCard label="Pending Assessment" value={metrics.pendingAssessment} trend="Steady" color="teal" />
                <MetricCard label="Escalated" value={metrics.escalated} trend="High" color="red" />
            </div>

            {/* Map & Recent Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 glass-panel p-10 rounded-[2.5rem] border border-white/5 relative overflow-hidden flex flex-col min-h-[500px]">
                    <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-ghi-teal/20 to-transparent"></div>
                    <div className="flex justify-between items-center mb-10">
                        <div>
                            <h3 className="text-lg font-black text-white uppercase tracking-widest">Global Outreach Map</h3>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Real-time biosecurity event mapping</p>
                        </div>
                        <div className="flex gap-2">
                            <div className="w-2 h-2 rounded-full bg-ghi-teal animate-ping"></div>
                            <span className="text-[9px] font-black text-ghi-teal uppercase tracking-widest">Live Sync</span>
                        </div>
                    </div>

                    <div className="flex-1 rounded-2xl bg-ghi-navy/30 border border-white/5 overflow-hidden relative cursor-crosshair">
                        <ComposableMap projectionConfig={{ scale: 140 }}>
                            <Geographies geography={geoUrl}>
                                {({ geographies }: { geographies: any[] }) =>
                                    geographies.map((geo: any) => {
                                        const isHot = hotZones.includes(geo.properties.name);
                                        return (
                                            <Geography
                                                key={geo.rsmKey}
                                                geography={geo}
                                                fill={isHot ? "rgba(255, 49, 49, 0.4)" : "rgba(255, 255, 255, 0.03)"}
                                                stroke={isHot ? "#FF3131" : "rgba(255, 255, 255, 0.05)"}
                                                strokeWidth={0.5}
                                                style={{
                                                    default: { outline: "none" },
                                                    hover: { fill: "rgba(0, 242, 255, 0.2)", outline: "none" },
                                                    pressed: { outline: "none" },
                                                }}
                                            />
                                        );
                                    })
                                }
                            </Geographies>
                        </ComposableMap>
                    </div>
                </div>

                <div className="glass-panel p-8 rounded-[2.5rem] border border-white/5 flex flex-col">
                    <h3 className="text-xs font-black text-white uppercase tracking-[0.2em] mb-8 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-ghi-warning"></span>
                        Recent Intelligence
                    </h3>
                    <div className="space-y-6 flex-1">
                        {metrics.recent.map((s: any) => (
                            <div key={s.id} className="group cursor-pointer">
                                <div className="flex justify-between items-start mb-2">
                                    <p className="text-[10px] font-black text-white uppercase tracking-wider group-hover:text-ghi-teal transition-colors">{s.disease}</p>
                                    <span className="text-[8px] font-bold text-slate-500 uppercase">{s.dateReported ? new Date(s.dateReported).toLocaleDateString() : 'N/A'}</span>
                                </div>
                                <p className="text-[9px] text-slate-500 uppercase font-bold tracking-widest">{s.country}</p>
                                <div className="mt-3 h-1 w-full bg-white/5 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full transition-all duration-1000 ${s.priorityScore > 85 ? 'bg-ghi-critical' : 'bg-ghi-teal'}`}
                                        style={{ width: `${s.priorityScore}%` }}
                                    ></div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <button className="w-full py-4 mt-8 bg-white/5 hover:bg-white/10 border border-white/5 rounded-2xl text-[9px] font-black text-slate-400 uppercase tracking-[0.3em] transition-all">
                        View Complete Log
                    </button>
                </div>
            </div>

            {/* Footer */}
            <div className="flex justify-between items-center pt-8 border-t border-white/5">
                <p className="text-slate-500 text-[9px] font-bold uppercase tracking-widest">
                    All rights reserved for PHA, Global Health Department
                </p>
                <div className="flex items-center gap-4">
                    <div className="flex -space-x-2">
                        <div className="w-6 h-6 rounded-full border-2 border-ghi-navy bg-slate-800 flex items-center justify-center text-[8px] font-black text-white">RA</div>
                    </div>
                    <p className="text-slate-500 text-[9px] font-bold uppercase tracking-widest">
                        System Architect: <span className="text-white">Rads Al-Garni</span>
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
