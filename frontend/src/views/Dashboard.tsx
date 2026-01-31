import { useState, useEffect } from 'react';
import { fetchSignals, fetchAssessments, fetchEscalations } from '../lib/api';
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps';

const geoUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// Mock centroids for common regions for map enhancement
const regionCentroids: any = {
    "DR Congo": [23.67, -4.03],
    "Sudan": [30.21, 12.86],
    "Vietnam": [108.27, 14.05],
    "Brazil": [-51.92, -14.23],
    "Saudi Arabia": [45.07, 23.88],
    "Nigeria": [8.67, 9.08],
    "India": [78.96, 20.59]
};

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

    const hotZones = signals.map(s => ({
        country: s.country,
        priority: s.priorityScore,
        disease: s.disease,
        id: s.id
    }));

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <div className="text-ghi-teal font-black animate-pulse uppercase tracking-[0.3em]">Calibrating Global Surveillance...</div>
        </div>
    );

    return (
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-1000 pb-10">
            {/* Metric Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <MetricCard label="Global Signals" value={metrics.total} trend="+12% LVL" color="teal" />
                <MetricCard label="Pending Triage" value={metrics.pendingTriage} trend="Critical" color="red" />
                <MetricCard label="Pending Assessment" value={metrics.pendingAssessment} trend="Steady" color="teal" />
                <MetricCard label="Escalated" value={metrics.escalated} trend="High" color="red" />
            </div>

            {/* Map & Recent Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <div className="lg:col-span-8 glass-panel p-6 lg:p-10 rounded-[2.5rem] border border-white/5 relative overflow-hidden flex flex-col min-h-[500px]">
                    <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-ghi-teal/20 to-transparent"></div>

                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10 gap-4">
                        <div>
                            <h3 className="text-lg font-black text-white uppercase tracking-widest">Global Outreach Map</h3>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Real-time biosecurity event mapping</p>
                        </div>
                        <div className="flex items-center gap-6">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-ghi-critical shadow-[0_0_8px_#FF3131]"></div>
                                <span className="text-[8px] font-black text-slate-400 uppercase">Critical</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-ghi-teal shadow-[0_0_8px_#00F2FF]"></div>
                                <span className="text-[8px] font-black text-slate-400 uppercase">Moderate</span>
                            </div>
                            <div className="h-4 w-px bg-white/10 hidden sm:block"></div>
                            <div className="flex gap-2">
                                <div className="w-2 h-2 rounded-full bg-ghi-teal animate-ping"></div>
                                <span className="text-[9px] font-black text-ghi-teal uppercase tracking-widest">Live Sync</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 rounded-[2rem] bg-ghi-navy/30 border border-white/5 overflow-hidden relative cursor-crosshair group/map">
                        {/* Map Overlay Scanline */}
                        <div className="absolute inset-0 pointer-events-none z-10 bg-[linear-gradient(transparent_0%,rgba(0,242,255,0.02)_50%,transparent_100%)] bg-[length:100%_4px] animate-[scanline_10s_linear_infinite]"></div>

                        <ComposableMap projectionConfig={{ scale: 140 }}>
                            <Geographies geography={geoUrl}>
                                {({ geographies }: { geographies: any[] }) =>
                                    geographies.map((geo: any) => {
                                        const countrySignals = hotZones.filter(z => z.country === geo.properties.name);
                                        const isHot = countrySignals.length > 0;
                                        const isCritical = countrySignals.some(s => s.priority > 85);

                                        return (
                                            <Geography
                                                key={geo.rsmKey}
                                                geography={geo}
                                                fill={isHot ? (isCritical ? "rgba(255, 49, 49, 0.3)" : "rgba(0, 242, 255, 0.2)") : "rgba(255, 255, 255, 0.02)"}
                                                stroke={isHot ? (isCritical ? "#FF3131" : "#00F2FF") : "rgba(255, 255, 255, 0.05)"}
                                                strokeWidth={0.5}
                                                style={{
                                                    default: { outline: "none" },
                                                    hover: { fill: "rgba(0, 242, 255, 0.3)", outline: "none" },
                                                    pressed: { outline: "none" },
                                                }}
                                            />
                                        );
                                    })
                                }
                            </Geographies>

                            {/* Signal Pulse Markers */}
                            {signals.map((s, i) => {
                                const coords = regionCentroids[s.country];
                                if (!coords) return null;
                                return (
                                    <Marker key={s.id || i} coordinates={coords}>
                                        <g className="animate-pulse">
                                            <circle r={4} fill={s.priorityScore > 85 ? "#FF3131" : "#00F2FF"} opacity={0.6} />
                                            <circle r={8} stroke={s.priorityScore > 85 ? "#FF3131" : "#00F2FF"} strokeWidth={1} fill="transparent" className="animate-ping" />
                                        </g>
                                    </Marker>
                                )
                            })}
                        </ComposableMap>
                    </div>
                </div>

                <div className="lg:col-span-4 glass-panel p-8 rounded-[2.5rem] border border-white/5 flex flex-col h-full">
                    <h3 className="text-xs font-black text-white uppercase tracking-[0.2em] mb-8 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-ghi-warning animate-pulse"></span>
                        Neural Intel Stream
                    </h3>
                    <div className="space-y-6 flex-1 overflow-y-auto pr-2 max-h-[500px]">
                        {metrics.recent.map((s: any) => (
                            <div key={s.id} className="group cursor-pointer p-4 rounded-2xl bg-white/[0.01] border border-transparent hover:border-white/5 hover:bg-white/[0.03] transition-all">
                                <div className="flex justify-between items-start mb-2">
                                    <p className="text-[10px] font-black text-white uppercase tracking-wider group-hover:text-ghi-teal transition-colors leading-tight">{s.disease}</p>
                                    <span className="text-[8px] font-bold text-slate-500 uppercase">{s.dateReported ? new Date(s.dateReported).toLocaleDateString() : 'N/A'}</span>
                                </div>
                                <p className="text-[9px] text-slate-400 uppercase font-black tracking-widest mb-3">{s.country}</p>
                                <div className="flex items-center gap-3">
                                    <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full transition-all duration-1000 ${s.priorityScore > 85 ? 'bg-ghi-critical shadow-[0_0_8px_#FF3131]' : 'bg-ghi-teal shadow-[0_0_8px_#00F2FF]'}`}
                                            style={{ width: `${s.priorityScore}%` }}
                                        ></div>
                                    </div>
                                    <span className={`text-[9px] font-black ${s.priorityScore > 85 ? 'text-ghi-critical' : 'text-ghi-teal'}`}>{s.priorityScore}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                    <button className="w-full py-4 mt-8 bg-ghi-teal/5 hover:bg-ghi-teal/10 border border-ghi-teal/20 rounded-2xl text-[9px] font-black text-ghi-teal uppercase tracking-[0.3em] transition-all">
                        Full Intelligence Log
                    </button>
                </div>
            </div>

            {/* Footer */}
            <div className="flex flex-col sm:flex-row justify-between items-center pt-8 border-t border-white/5 gap-4">
                <p className="text-slate-600 text-[9px] font-bold uppercase tracking-widest text-center sm:text-left">
                    Official GHI Surveillance Terminal // Ministry of Health
                </p>
                <div className="flex items-center gap-4 text-slate-500 text-[8px] font-black uppercase tracking-widest">
                    <span>Alpha Sector Link</span>
                    <div className="w-1.5 h-1.5 rounded-full bg-ghi-success shadow-[0_0_8px_#39FF14]"></div>
                </div>
            </div>

            <style>{`
                @keyframes scanline {
                    from { transform: translateY(-100%); }
                    to { transform: translateY(100%); }
                }
            `}</style>
        </div>
    );
};

export default Dashboard;
