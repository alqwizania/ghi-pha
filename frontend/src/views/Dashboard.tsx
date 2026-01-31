import { useState, useEffect, useMemo } from 'react';
import { fetchSignals, fetchAssessments, fetchEscalations } from '../lib/api';
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps';

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
    "Egypt": [30.80, 26.82]
};

// Mini Sparkline Component
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
            <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.2em]">{label}</p>
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

const Dashboard = () => {
    const [signals, setSignals] = useState<any[]>([]);
    const [assessments, setAssessments] = useState<any[]>([]);
    const [escalations, setEscalations] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [hoveredCountry, setHoveredCountry] = useState<any>(null);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

    useEffect(() => {
        Promise.all([fetchSignals(), fetchAssessments(), fetchEscalations()])
            .then(([s, a, e]) => {
                setSignals(s);
                setAssessments(a);
                setEscalations(e);
            })
            .finally(() => setLoading(false));
    }, []);

    const metrics = useMemo(() => ({
        total: signals.length,
        pendingTriage: signals.filter(s => s.triageStatus === 'Pending Triage').length,
        pendingAssessment: assessments.filter(a => a.status !== 'Completed').length,
        escalated: escalations.length,
        recent: signals.slice(0, 5)
    }), [signals, assessments, escalations]);

    // Mock history for sparklines
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
                <MetricCard label="Global Signals" value={metrics.total} trend="+12% VEL" color="teal" history={historyData.total} />
                <MetricCard label="Pending Triage" value={metrics.pendingTriage} trend="CRITICAL" color="red" history={historyData.triage} />
                <MetricCard label="Pending Assessment" value={metrics.pendingAssessment} trend="STABLE" color="teal" history={historyData.assessment} />
                <MetricCard label="Escalated" value={metrics.escalated} trend="HIGH" color="red" history={historyData.escalated} />
            </div>

            {/* Map & Recent Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <div className="lg:col-span-8 glass-panel p-6 lg:p-10 rounded-[2.5rem] border border-white/5 relative overflow-hidden flex flex-col min-h-[550px]">
                    <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-ghi-teal/20 to-transparent"></div>

                    {/* Neural Grid Overlay */}
                    <div className="absolute inset-0 opacity-[0.03] pointer-events-none z-0">
                        <div className="w-full h-full bg-[radial-gradient(circle_at_center,_transparent_0%,_#000_100%),_linear-gradient(rgba(0,242,255,0.4)_1px,transparent_1px),_linear-gradient(90deg,rgba(0,242,255,0.4)_1px,transparent_1px)] bg-[size:100%_100%,40px_40px,40px_40px] animate-[pulse_8s_infinite]"></div>
                    </div>

                    <div className="relative z-10 flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10 gap-4">
                        <div>
                            <div className="flex items-center gap-3 mb-1">
                                <div className="w-4 h-[2px] bg-ghi-teal"></div>
                                <h3 className="text-lg font-black text-white uppercase tracking-widest leading-none">Global Outreach Command</h3>
                            </div>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest ml-7">Neural Event Surveillance Mesh</p>
                        </div>
                        <div className="flex items-center gap-6">
                            <div className="flex gap-2">
                                <div className="w-2 h-2 rounded-full bg-ghi-teal animate-ping"></div>
                                <span className="text-[9px] font-black text-ghi-teal uppercase tracking-widest">System Link: Stable</span>
                            </div>
                        </div>
                    </div>

                    <div
                        className="flex-1 rounded-[2rem] bg-ghi-navy/20 border border-white/5 overflow-hidden relative cursor-crosshair group/map z-10"
                        onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
                    >
                        {/* Map Overlay Scanline */}
                        <div className="absolute inset-0 pointer-events-none z-20 bg-[linear-gradient(transparent_0%,rgba(0,242,255,0.01)_50%,transparent_100%)] bg-[length:100%_8px] animate-[scanline_12s_linear_infinite]"></div>

                        <ComposableMap projectionConfig={{ scale: 145 }}>
                            <Geographies geography={geoUrl}>
                                {({ geographies }: { geographies: any[] }) =>
                                    geographies.map((geo: any) => {
                                        const countrySignals = signals.filter(z => z.country === geo.properties.name);
                                        const isHot = countrySignals.length > 0;
                                        const isCritical = countrySignals.some(s => s.priorityScore > 85);
                                        const intensity = Math.min(countrySignals.length * 0.2, 0.4);

                                        return (
                                            <Geography
                                                key={geo.rsmKey}
                                                geography={geo}
                                                onMouseEnter={() => {
                                                    if (isHot) setHoveredCountry({
                                                        name: geo.properties.name,
                                                        signals: countrySignals
                                                    });
                                                }}
                                                onMouseLeave={() => setHoveredCountry(null)}
                                                fill={isHot ? (isCritical ? `rgba(255, 49, 49, ${0.2 + intensity})` : `rgba(0, 242, 255, ${0.2 + intensity})`) : "rgba(255, 255, 255, 0.02)"}
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

                            {/* Epidemiological Heat-Map (Radial Glows) */}
                            {signals.map((s, i) => {
                                const coords = regionCentroids[s.country];
                                if (!coords) return null;
                                return (
                                    <Marker key={s.id || i} coordinates={coords}>
                                        <circle
                                            r={15}
                                            fill={s.priorityScore > 85 ? "url(#criticalGlow)" : "url(#tealGlow)"}
                                            className="animate-pulse"
                                        />
                                    </Marker>
                                )
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

                            {/* Signal Markers */}
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
                                )
                            })}
                        </ComposableMap>

                        {/* Interactive Pulse Card (Tooltip) */}
                        {hoveredCountry && (
                            <div
                                className="fixed z-[100] pointer-events-none animate-in fade-in zoom-in-95 duration-200"
                                style={{ left: mousePos.x + 20, top: mousePos.y - 20 }}
                            >
                                <div className="glass-panel p-4 rounded-2xl border border-ghi-teal/30 shadow-2xl backdrop-blur-xl w-64">
                                    <div className="flex justify-between items-start mb-3">
                                        <h4 className="text-[10px] font-black text-white uppercase tracking-widest">{hoveredCountry.name}</h4>
                                        <span className="text-[8px] font-black text-ghi-teal uppercase">Active Site</span>
                                    </div>
                                    <div className="space-y-3">
                                        {hoveredCountry.signals.map((s: any) => (
                                            <div key={s.id} className="p-2 rounded-lg bg-white/5 border border-white/5">
                                                <p className="text-[9px] font-black text-white uppercase mb-1">{s.disease}</p>
                                                <div className="flex justify-between items-center text-[7px] font-black text-slate-500 uppercase">
                                                    <span>Status: {s.triageStatus}</span>
                                                    <span className="text-ghi-teal">v.{s.priorityScore}%</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="mt-4 pt-3 border-t border-white/5 flex justify-between items-center">
                                        <span className="text-[7px] font-black text-slate-600 uppercase">T.Sync: 0.2ms</span>
                                        <span className="text-[7px] font-black text-ghi-teal uppercase">Neural Verified</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="lg:col-span-4 glass-panel p-8 rounded-[2.5rem] border border-white/5 flex flex-col h-full bg-ghi-navy/10 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-ghi-teal/5 blur-[50px] -mr-16 -mt-16"></div>
                    <h3 className="text-xs font-black text-white uppercase tracking-[0.2em] mb-8 flex items-center gap-2 relative z-10">
                        <span className="w-1.5 h-1.5 rounded-full bg-ghi-warning animate-pulse"></span>
                        Strategic Stream
                    </h3>
                    <div className="space-y-4 flex-1 overflow-y-auto pr-2 max-h-[480px] custom-scrollbar relative z-10">
                        {metrics.recent.map((s: any) => (
                            <div key={s.id} className="group cursor-pointer p-4 rounded-2xl bg-white/[0.01] border border-white/5 hover:border-ghi-teal/30 hover:bg-white/[0.03] transition-all relative overflow-hidden">
                                <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-transparent via-ghi-teal/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                <div className="flex justify-between items-start mb-2">
                                    <p className="text-[10px] font-black text-white uppercase tracking-wider group-hover:text-ghi-teal transition-colors leading-tight">{s.disease}</p>
                                    <span className="text-[8px] font-bold text-slate-600 uppercase">{s.dateReported ? new Date(s.dateReported).toLocaleDateString() : 'N/A'}</span>
                                </div>
                                <p className="text-[9px] text-slate-400 font-black tracking-widest mb-3 uppercase">{s.country}</p>
                                <div className="flex items-center gap-3">
                                    <div className="flex-1 h-[2px] bg-white/5 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full transition-all duration-1000 ${s.priorityScore > 85 ? 'bg-ghi-critical shadow-[0_0_8px_#FF3131]' : 'bg-ghi-teal shadow-[0_0_8px_#00F2FF]'}`}
                                            style={{ width: `${s.priorityScore}%` }}
                                        ></div>
                                    </div>
                                    <span className={`text-[9px] font-black ${s.priorityScore > 85 ? 'text-ghi-critical' : 'text-ghi-teal'}`}>{s.priorityScore}%</span>
                                </div>
                            </div>
                        ))}
                    </div>
                    <button className="w-full py-4 mt-8 bg-white/5 hover:bg-white/10 border border-white/5 rounded-2xl text-[9px] font-black text-slate-400 uppercase tracking-[0.3em] transition-all relative z-10">
                        Decrypt Complete Log
                    </button>
                </div>
            </div>

            {/* Global Legend */}
            <div className="glass-panel p-6 rounded-[2rem] border border-white/5 flex flex-wrap items-center justify-center gap-10">
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

            {/* Footer */}
            <div className="flex flex-col sm:flex-row justify-between items-center pt-8 border-t border-white/5 gap-4">
                <p className="text-slate-700 text-[9px] font-bold uppercase tracking-widest text-center sm:text-left">
                    All rights reserved for PHA, Global Health Department // Secured Alpha Terminal
                </p>
                <div className="flex items-center gap-6 text-slate-500 text-[8px] font-black uppercase tracking-widest">
                    <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-ghi-success"></div>
                        <span>Link: Primary-01</span>
                    </div>
                    <span className="opacity-30">|</span>
                    <span>T-SEC: Level 5</span>
                </div>
            </div>

            <style>{`
                @keyframes scanline {
                    from { transform: translateY(-100%); }
                    to { transform: translateY(150%); }
                }
                .custom-scrollbar::-webkit-scrollbar {
                    width: 2px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(0, 242, 255, 0.1);
                    border-radius: 10px;
                }
            `}</style>
        </div>
    );
};

export default Dashboard;
