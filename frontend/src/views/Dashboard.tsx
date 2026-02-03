import { useState, useEffect, useMemo } from 'react';
import { fetchSignals, fetchAssessments, fetchEscalations } from '../lib/api';
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from 'react-simple-maps';

const geoUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

const regionCentroids: any = {
    "DR Congo": [23.67, -4.03],
    "Sudan": [30.21, 12.86],
    "Vietnam": [108.27, 14.05],
    "Brazil": [-51.92, -14.23],
    "Saudi Arabia": [45.07, 23.88],
    "Nigeria": [8.67, 9.08],
    "India": [78.96, 20.59],
    "China": [104.19, 35.86],
    "USA": [-95.71, 37.09],
    "Egypt": [30.80, 26.82],
    "Yemen": [48.51, 15.55],
    "Jordan": [36.23, 30.58],
    "Iraq": [43.67, 33.22],
    "Oman": [55.97, 21.51],
    "UAE": [53.84, 23.42],
    "Qatar": [51.18, 25.35],
    "Kuwait": [47.48, 29.31],
    "Bahrain": [50.58, 26.06]
};

const KSA_NEIGHBORS = ['Saudi Arabia', 'UAE', 'United Arab Emirates', 'Qatar', 'Kuwait', 'Bahrain', 'Oman', 'Yemen', 'Jordan', 'Iraq', 'Egypt'];

const Sparkline = ({ data, color }: { data: number[], color: string }) => {
    const max = Math.max(...data, 1);
    const width = 80;
    const height = 20;
    const points = data.map((d, i) => `${(i / (data.length - 1)) * width},${height - (d / max) * height}`).join(' ');

    return (
        <svg width={width} height={height} className="overflow-visible">
            <polyline
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                points={points}
                className="drop-shadow-[0_0_3px_rgba(0,242,255,0.5)]"
            />
            <circle cx={width} cy={height - (data[data.length - 1] / max) * height} r="2" fill={color} />
        </svg>
    );
};

interface MetricCardProps {
    label: string;
    value: number;
    trend: string;
    color: 'red' | 'teal';
    history: number[];
}

const MetricCard = ({ label, value, trend, color, history }: MetricCardProps) => (
    <div className="glass-panel p-6 rounded-3xl border border-white/5 hover:border-ghi-teal/20 transition-all duration-500 group relative overflow-hidden">
        <div className={`absolute top-0 right-0 w-24 h-24 blur-[60px] rounded-full -mr-12 -mt-12 transition-all duration-700 ${color === 'red' ? 'bg-ghi-critical/10 group-hover:bg-ghi-critical/20' : 'bg-ghi-teal/10 group-hover:bg-ghi-teal/20'}`}></div>
        <div className="flex justify-between items-start mb-4">
            <p className="text-slate-500 text-[11px] font-black uppercase tracking-[0.2em]">{label}</p>
            <Sparkline data={history} color={color === 'red' ? '#FF3131' : '#00F2FF'} />
        </div>
        <div className="flex items-end justify-between relative z-10">
            <h3 className="text-4xl font-black text-white tracking-tighter">{value}</h3>
            <span className={`text-[10px] font-black px-2 py-1 rounded-lg border ${color === 'red' ? 'bg-ghi-critical/5 text-ghi-critical border-ghi-critical/20' : 'bg-ghi-teal/5 text-ghi-teal border-ghi-teal/20'}`}>
                {trend}
            </span>
        </div>
    </div>
);

const RadarSignalCard = ({ signal }: any) => {
    const isCritical = signal.priorityScore > 85;
    const isKSA = signal.country.toLowerCase().includes('saudi');

    return (
        <div className="relative group p-4 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-ghi-teal/20 transition-all duration-500 overflow-hidden">
            {isCritical && <div className="absolute inset-0 bg-ghi-critical/5 animate-pulse"></div>}
            <div className="flex justify-between items-start mb-2 relative z-10">
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${isCritical ? 'bg-ghi-critical shadow-[0_0_8px_#FF3131]' : 'bg-ghi-teal shadow-[0_0_8px_#00F2FF]'} ${isCritical ? 'animate-ping' : ''}`}></div>
                    <span className={`text-[10px] font-black uppercase tracking-widest ${isKSA ? 'text-ghi-critical' : 'text-ghi-teal'}`}>
                        {isKSA ? 'INTERNAL THREAT' : 'BORDER ALERT'}
                    </span>
                </div>
                <span className="text-[10px] font-bold text-slate-500 uppercase">{signal.country}</span>
            </div>
            <h4 className="text-white font-black text-sm uppercase mb-1 tracking-tight truncate">{signal.disease}</h4>
            <div className="flex justify-between items-center relative z-10">
                <span className="text-[9px] font-bold text-slate-600 uppercase">Velocity: {signal.cases > 50 ? 'ACCELERATING' : 'STABLE'}</span>
                <span className={`text-xs font-black ${isCritical ? 'text-ghi-critical' : 'text-ghi-teal'}`}>LVL {signal.priorityScore}</span>
            </div>
        </div>
    );
};

const SentinelPerimeter = () => (
    <g className="pointer-events-none">
        <circle cx="45" cy="24" r="8" fill="none" stroke="#00F2FF" strokeWidth="0.5" strokeDasharray="2 2" className="animate-pulse" opacity="0.2" />
        <circle cx="45" cy="23" r="12" fill="none" stroke="#00F2FF" strokeWidth="0.2" opacity="0.1" />
    </g>
);

const Dashboard = () => {
    const [signals, setSignals] = useState<any[]>([]);
    const [assessments, setAssessments] = useState<any[]>([]);
    const [escalations, setEscalations] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [hoveredCountry, setHoveredCountry] = useState<any>(null);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [center, setCenter] = useState<[number, number]>([20, 0]);

    const handleZoomIn = () => setZoom(prev => Math.min(prev * 1.5, 8));
    const handleZoomOut = () => setZoom(prev => Math.max(prev / 1.5, 1));
    const handleReset = () => {
        setZoom(1);
        setCenter([20, 0]);
    };

    useEffect(() => {
        Promise.all([fetchSignals(), fetchAssessments(), fetchEscalations()])
            .then(([s, a, e]) => {
                setSignals(s);
                setAssessments(a);
                setEscalations(e);
            })
            .finally(() => setLoading(false));
    }, []);

    const metrics = useMemo(() => {
        const totalCount = signals.length;
        const triageCount = signals.filter(s => s.triageStatus === 'Pending Triage').length;
        const assessmentCount = assessments.filter(a => a.status !== 'Completed').length;
        const escalationCount = escalations.length;

        const proximitySignals = signals.filter(s =>
            KSA_NEIGHBORS.some(n => s.country.toLowerCase().includes(n.toLowerCase())) ||
            s.priorityScore > 90
        ).slice(0, 4);

        return {
            total: totalCount,
            pendingTriage: triageCount,
            pendingAssessment: assessmentCount,
            escalated: escalationCount,
            recent: signals.slice(0, 5),
            proximity: proximitySignals,
            trends: {
                total: totalCount > 0 ? "+VEL" : "EMPTY",
                triage: triageCount > 5 ? "CRITICAL" : (triageCount > 0 ? "PENDING" : "CLEAR"),
                assessment: assessmentCount > 0 ? "ACTIVE" : "NOMINAL",
                escalated: escalationCount > 0 ? "HIGH" : "NOMINAL"
            }
        };
    }, [signals, assessments, escalations]);

    const historyData = {
        total: [12, 15, 14, 18, 22, 21, 25],
        triage: [5, 4, 8, 3, 6, 9, 8],
        assessment: [10, 12, 11, 14, 13, 15, 16],
        escalated: [2, 3, 1, 4, 2, 5, 4]
    };

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <div className="text-ghi-teal font-black animate-pulse uppercase tracking-[0.3em]">Calibrating Global Surveillance...</div>
        </div>
    );

    return (
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-1000 pb-10">
            {/* Metric Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <MetricCard label="Global Signals" value={metrics.total} trend={metrics.trends.total} color="teal" history={historyData.total} />
                <MetricCard label="Pending Triage" value={metrics.pendingTriage} trend={metrics.trends.triage} color={metrics.pendingTriage > 5 ? "red" : "teal"} history={historyData.triage} />
                <MetricCard label="Pending Assessment" value={metrics.pendingAssessment} trend={metrics.trends.assessment} color="teal" history={historyData.assessment} />
                <MetricCard label="Escalated" value={metrics.escalated} trend={metrics.trends.escalated} color={metrics.escalated > 0 ? "red" : "teal"} history={historyData.escalated} />
            </div>

            {/* Intelligence Grid: Radar | Map | Pulse */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start relative z-10">
                {/* Kingdom Proximity Radar */}
                <div className="xl:col-span-3 space-y-6 flex flex-col h-[650px] lg:h-[700px]">
                    <div className="glass-panel p-8 rounded-[2.5rem] border border-ghi-teal/20 relative overflow-hidden flex flex-col bg-[#050505]/40 h-full">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-ghi-teal/5 blur-3xl rounded-full -mr-16 -mt-16"></div>
                        <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-3">
                                <div className="relative">
                                    <div className="w-3 h-3 bg-ghi-teal rounded-full animate-ping absolute inset-0"></div>
                                    <div className="w-3 h-3 bg-ghi-teal rounded-full relative z-10 shadow-[0_0_10px_#00F2FF]"></div>
                                </div>
                                <h3 className="text-xs font-black text-white uppercase tracking-[0.3em]">Sentinel Radar</h3>
                            </div>
                            <span className="text-[9px] font-black text-ghi-teal/50 animate-pulse uppercase tracking-widest">Scanning...</span>
                        </div>
                        <div className="space-y-4 flex-1 overflow-y-auto custom-scrollbar pr-2">
                            {metrics.proximity.length > 0 ? (
                                metrics.proximity.map((s: any) => <RadarSignalCard key={s.id} signal={s} />)
                            ) : (
                                <div className="py-20 text-center border border-dashed border-white/5 rounded-3xl bg-white/[0.01]">
                                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] px-6">No border threats in proximity</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Map Section */}
                <div className="xl:col-span-6 flex flex-col min-h-[650px] lg:h-[700px]">
                    <div className="glass-panel p-6 lg:p-10 rounded-[2.5rem] border border-white/5 relative overflow-hidden flex flex-col flex-1 bg-[#050505]/40">
                        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-ghi-teal/20 to-transparent"></div>
                        <div className="relative z-10 flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10 gap-4">
                            <div>
                                <div className="flex items-center gap-3 mb-1 text-left">
                                    <div className="w-4 h-[2px] bg-ghi-teal"></div>
                                    <h3 className="text-lg font-black text-white uppercase tracking-widest leading-none">Global Health Signals Map</h3>
                                </div>
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest ml-7 text-left">Neural Event Surveillance Mesh</p>
                            </div>
                            <div className="flex items-center gap-6">
                                <div className="flex gap-2">
                                    <div className="w-2 h-2 rounded-full bg-ghi-teal animate-ping"></div>
                                    <span className="text-[10px] font-black text-white uppercase tracking-widest">System Link: Stable</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 rounded-[2rem] bg-ghi-navy/20 border border-white/5 overflow-hidden relative cursor-crosshair group/map z-10" onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}>
                            <div className="absolute bottom-6 right-6 z-30 flex flex-col gap-2">
                                <button onClick={handleZoomIn} className="w-10 h-10 rounded-xl bg-ghi-navy/80 border border-white/10 text-ghi-teal flex items-center justify-center hover:bg-ghi-teal/20 transition-all font-black">+</button>
                                <button onClick={handleZoomOut} className="w-10 h-10 rounded-xl bg-ghi-navy/80 border border-white/10 text-ghi-teal flex items-center justify-center hover:bg-ghi-teal/20 transition-all font-black">-</button>
                                <button onClick={handleReset} className="mt-2 px-3 py-2 rounded-xl bg-ghi-teal/10 border border-ghi-teal/20 text-[8px] font-black text-ghi-teal uppercase tracking-widest hover:bg-ghi-teal/20 transition-all">Recenter KSA</button>
                            </div>
                            <div className="absolute inset-0 pointer-events-none z-20 bg-[linear-gradient(transparent_0%,rgba(0,242,255,0.01)_50%,transparent_100%)] bg-[length:100%_8px] animate-[scanline_12s_linear_infinite]"></div>
                            <ComposableMap projectionConfig={{ scale: 145 }}>
                                <ZoomableGroup zoom={zoom} center={center} onMoveEnd={({ coordinates, zoom }: { coordinates: [number, number], zoom: number }) => { setCenter(coordinates); setZoom(zoom); }}>
                                    <Geographies geography={geoUrl}>
                                        {({ geographies }: { geographies: any[] }) => geographies.map((geo: any) => {
                                            const countrySignals = signals.filter(z => z.country === geo.properties.name);
                                            const isHot = countrySignals.length > 0;
                                            const isCritical = countrySignals.some(s => s.priorityScore > 85);
                                            const intensity = Math.min(countrySignals.length * 0.2, 0.4);
                                            return (
                                                <Geography
                                                    key={geo.rsmKey}
                                                    geography={geo}
                                                    onMouseEnter={() => { if (isHot) setHoveredCountry({ name: geo.properties.name, signals: countrySignals }); }}
                                                    onMouseLeave={() => setHoveredCountry(null)}
                                                    fill={isHot ? (isCritical ? `rgba(255, 49, 49, ${0.2 + intensity})` : `rgba(0, 242, 255, ${0.2 + intensity})`) : "rgba(255, 255, 255, 0.02)"}
                                                    stroke={isHot ? (isCritical ? "#FF3131" : "#00F2FF") : "rgba(255, 255, 255, 0.05)"}
                                                    strokeWidth={0.5}
                                                    style={{ default: { outline: "none" }, hover: { fill: "rgba(0, 242, 255, 0.3)", outline: "none" }, pressed: { outline: "none" } }}
                                                />
                                            );
                                        })}
                                    </Geographies>
                                    {signals.map((s, i) => {
                                        const coords = regionCentroids[s.country];
                                        if (!coords) return null;
                                        return (
                                            <Marker key={`glow-${s.id || i}`} coordinates={coords}>
                                                <circle r={15} fill={s.priorityScore > 85 ? "url(#criticalGlow)" : "url(#tealGlow)"} className="animate-pulse" />
                                            </Marker>
                                        );
                                    })}
                                    <defs>
                                        <radialGradient id="tealGlow">
                                            <stop offset="0%" stopColor="#00F2FF" stopOpacity="0.4" />
                                            <stop offset="100%" stopColor="#00F2FF" stopOpacity="0" />
                                        </radialGradient>
                                        <radialGradient id="criticalGlow">
                                            <stop offset="0%" stopColor="#FF3131" stopOpacity="0.4" />
                                            <stop offset="100%" stopColor="#FF3131" stopOpacity="0" />
                                        </radialGradient>
                                    </defs>
                                    {signals.map((s, i) => {
                                        const coords = regionCentroids[s.country];
                                        if (!coords) return null;
                                        return (
                                            <Marker key={`marker-${s.id || i}`} coordinates={coords}>
                                                <g>
                                                    <circle r={2.5} fill={s.priorityScore > 85 ? "#FF3131" : "#00F2FF"} />
                                                    <circle r={6} stroke={s.priorityScore > 85 ? "#FF3131" : "#00F2FF"} strokeWidth={1} fill="transparent" className="animate-ping" style={{ animationDuration: '3s' }} />
                                                </g>
                                            </Marker>
                                        );
                                    })}
                                    <SentinelPerimeter />
                                </ZoomableGroup>
                            </ComposableMap>

                            {hoveredCountry && (
                                <div className="fixed z-[100] pointer-events-none animate-in fade-in zoom-in-95 duration-200" style={{ left: mousePos.x + 20, top: mousePos.y - 20 }}>
                                    <div className="glass-panel p-5 rounded-2xl border border-ghi-teal/40 shadow-2xl backdrop-blur-xl w-72 bg-black/90">
                                        <div className="flex justify-between items-start mb-4 border-b border-white/10 pb-2">
                                            <h4 className="text-sm font-black text-white uppercase tracking-widest">{hoveredCountry.name}</h4>
                                            <span className="text-[10px] font-black text-ghi-teal uppercase">Active Site</span>
                                        </div>
                                        <div className="space-y-4">
                                            {hoveredCountry.signals.map((s: any) => (
                                                <div key={s.id} className="p-3 rounded-xl bg-white/[0.03] border border-white/5 text-left">
                                                    <p className="text-xs font-black text-white uppercase mb-2">{s.disease}</p>
                                                    <div className="flex justify-between items-center text-[10px] font-black text-slate-400 uppercase">
                                                        <span>Status: {s.triageStatus || 'Pending'}</span>
                                                        <span className="text-ghi-teal">Priority: {s.priorityScore}%</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="mt-5 pt-3 border-t border-white/10 flex justify-between items-center">
                                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-tighter">Temporal Sync: 0.2ms</span>
                                            <span className="text-[9px] font-black text-ghi-teal uppercase tracking-tighter">Neural Verified</span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Global Legend - Relocated under Map */}
                    <div className="mt-6 glass-panel p-6 rounded-[2rem] border border-white/5 flex flex-wrap items-center justify-center gap-10 bg-[#050505]/40">
                        <div className="flex items-center gap-4">
                            <div className="w-3 h-3 rounded-sm bg-ghi-critical/40 border border-ghi-critical/60"></div>
                            <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Active Pathogen (Critical)</span>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="w-3 h-3 rounded-sm bg-ghi-teal/40 border border-ghi-teal/60"></div>
                            <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Surveillance Target (Moderate)</span>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="w-6 h-[1.5px] bg-gradient-to-r from-transparent via-ghi-teal to-transparent"></div>
                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Neural Mesh: Operational</span>
                        </div>
                    </div>
                </div>

                {/* Global Pulse Column */}
                <div className="xl:col-span-3 space-y-6 flex flex-col h-[650px] lg:h-[700px]">
                    <div className="glass-panel p-8 rounded-[2.5rem] border border-white/5 flex flex-col h-full bg-[#050505]/40 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-ghi-teal/5 blur-[50px] -mr-16 -mt-16"></div>
                        <h3 className="text-xs font-black text-white uppercase tracking-[0.3em] mb-8 flex items-center gap-3 relative z-10">
                            <span className="w-1.5 h-1.5 rounded-full bg-ghi-warning animate-pulse shadow-[0_0_5px_#F4B400]"></span>
                            Global Pulse
                        </h3>
                        <div className="space-y-4 flex-1 overflow-y-auto pr-2 custom-scrollbar relative z-10">
                            {metrics.recent.map((s: any) => (
                                <div key={s.id} className="group cursor-pointer p-5 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-ghi-teal/30 hover:bg-white/[0.04] transition-all duration-300 relative overflow-hidden">
                                    <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-transparent via-ghi-teal/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                    <div className="flex justify-between items-start mb-3 text-left">
                                        <p className="text-[13px] font-black text-white uppercase tracking-wider group-hover:text-ghi-teal transition-colors leading-tight">{s.disease}</p>
                                        <span className="text-[10px] font-bold text-slate-600 uppercase">{s.dateReported ? new Date(s.dateReported).toLocaleDateString() : 'N/A'}</span>
                                    </div>
                                    <p className="text-[11px] text-slate-500 font-black tracking-[0.2em] mb-4 uppercase text-left">{s.country}</p>
                                    <div className="flex items-center gap-3">
                                        <div className="flex-1 h-[2px] bg-white/5 rounded-full overflow-hidden">
                                            <div className={`h-full transition-all duration-1000 ${s.priorityScore > 85 ? 'bg-ghi-critical shadow-[0_0_8px_#FF3131]' : 'bg-ghi-teal shadow-[0_0_8px_#00F2FF]'}`} style={{ width: `${s.priorityScore}%` }}></div>
                                        </div>
                                        <span className={`text-[10px] font-black ${s.priorityScore > 85 ? 'text-ghi-critical' : 'text-ghi-teal'}`}>{s.priorityScore}%</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <button className="w-full py-4 mt-8 bg-white/5 hover:bg-white/10 border border-white/5 rounded-2xl text-[9px] font-black text-slate-400 uppercase tracking-[0.3em] transition-all relative z-10">Access Full Logs</button>
                    </div>
                </div>
            </div>


            <style>{`
                @keyframes scanline { from { transform: translateY(-100%); } to { transform: translateY(150%); } }
                .custom-scrollbar::-webkit-scrollbar { width: 2px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0, 242, 255, 0.1); border-radius: 10px; }
            `}</style>
        </div>
    );
};

export default Dashboard;
