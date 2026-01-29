

const MetricCard = ({ label, value, trend, color }: any) => (
    <div className="glass-panel p-6 rounded-2xl border border-ghi-blue/10 relative overflow-hidden group hover:border-ghi-blue/30 transition-all duration-500">
        <div className="absolute top-0 right-0 w-24 h-24 bg-ghi-teal/5 blur-3xl rounded-full -mr-12 -mt-12 group-hover:bg-ghi-teal/10 transition-colors"></div>
        <p className="text-slate-500 text-[10px] font-black tracking-[0.2em] uppercase mb-3 relative z-10">{label}</p>
        <div className="flex items-end justify-between relative z-10">
            <h3 className="text-4xl font-black text-white tracking-tighter">{value}</h3>
            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-opacity-10 text-[10px] font-black ${color === 'red' ? 'bg-ghi-critical text-ghi-critical' : 'bg-ghi-teal text-ghi-teal'}`}>
                {trend}
            </div>
        </div>
    </div>
);

const Dashboard = () => {
    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
            {/* Metrics Row */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <MetricCard label="Global Signals" value="1,247" trend="+12%" color="teal" />
                <MetricCard label="Pending Triage" value="18" trend="+5%" color="red" />
                <MetricCard label="Active Assessments" value="12" trend="-2" color="teal" />
                <MetricCard label="Escalations" value="03" trend="+1" color="red" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Map Placeholder */}
                <div className="lg:col-span-2 glass-panel rounded-3xl aspect-video border border-ghi-blue/10 relative overflow-hidden flex items-center justify-center group shadow-2xl shadow-ghi-teal/5">
                    <div className="absolute inset-0 bg-ghi-navy/50 backdrop-blur-sm z-0"></div>
                    {/* Grid overlay for digital look */}
                    <div className="absolute inset-0 bg-[linear-gradient(rgba(0,242,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(0,242,255,0.05)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_at_center,black,transparent)]"></div>

                    {/* Mock map graphic */}
                    <div className="relative z-10 text-center">
                        <div className="w-16 h-16 border-2 border-ghi-teal/20 border-t-ghi-teal rounded-full animate-spin mb-6 mx-auto shadow-[0_0_15px_rgba(0,242,255,0.2)]"></div>
                        <p className="text-ghi-teal font-black text-xs tracking-[0.3em] uppercase neon-text">Initializing Surveillance Matrix...</p>
                        <p className="text-slate-500 text-[10px] mt-2 font-bold uppercase tracking-widest">Geo-spatial Link Secured</p>
                    </div>
                </div>

                {/* Sidebar Data */}
                <div className="space-y-8">
                    <div className="glass-panel rounded-3xl p-8 border border-ghi-blue/10">
                        <h4 className="text-[10px] font-black text-white mb-6 uppercase tracking-[0.3em] flex items-center gap-3">
                            <span className="w-1.5 h-1.5 rounded-full bg-ghi-teal shadow-[0_0_8px_#00F2FF]"></span>
                            Hot Zones
                        </h4>
                        <div className="space-y-6">
                            {[
                                { name: 'Nigeria', count: 45, color: 'bg-ghi-critical shadow-[0_0_8px_#FF3131]' },
                                { name: 'India', count: 32, color: 'bg-ghi-warning shadow-[0_0_8px_#FFD700]' },
                                { name: 'DRC', count: 28, color: 'bg-ghi-teal shadow-[0_0_8px_#00F2FF]' },
                                { name: 'Yemen', count: 21, color: 'bg-ghi-blue shadow-[0_0_8px_#00BAFF]' },
                            ].map((c) => (
                                <div key={c.name} className="group">
                                    <div className="flex justify-between text-[10px] mb-2 font-bold">
                                        <span className="text-slate-400 group-hover:text-white transition-colors uppercase tracking-widest">{c.name}</span>
                                        <span className="text-white font-black">{c.count}</span>
                                    </div>
                                    <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                                        <div className={`${c.color} h-full transition-all duration-1000 ease-out`} style={{ width: `${(c.count / 45) * 100}%` }}></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="glass-panel rounded-3xl p-8 border border-ghi-blue/10">
                        <h4 className="text-[10px] font-black text-white mb-6 uppercase tracking-[0.3em] flex items-center gap-3">
                            <span className="w-1.5 h-1.5 rounded-full bg-ghi-teal shadow-[0_0_8px_#00F2FF]"></span>
                            Event Stream
                        </h4>
                        <div className="space-y-6">
                            {[
                                { user: 'Abdulmalek AlQwizani', action: 'triaged', item: 'Ebola - DRC', time: '12m ago' },
                                { user: 'System', action: 'polled', item: 'Beacon sync complete', time: '25m ago' },
                                { user: 'Dr. Fatima', action: 'resolved', item: 'MERS-CoV - RIY', time: '1h ago' },
                            ].map((a, i) => (
                                <div key={i} className="flex gap-4 text-[10px]">
                                    <div className="flex flex-col items-center">
                                        <div className="w-2 h-2 rounded-full border border-ghi-teal/50 bg-ghi-navy relative z-10"></div>
                                        {i < 2 && <div className="w-[1px] flex-1 bg-ghi-teal/20 my-1"></div>}
                                    </div>
                                    <div className="pb-1">
                                        <p className="text-slate-400 leading-none">
                                            <span className="text-white font-black uppercase tracking-widest">{a.user}</span>
                                            <span className="mx-1 text-slate-600 font-bold uppercase">{a.action}</span>
                                        </p>
                                        <p className="text-ghi-teal font-black mt-1.5 uppercase tracking-widest neon-text">{a.item}</p>
                                        <p className="text-slate-500 text-[8px] font-black uppercase mt-1 tracking-widest">{a.time}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
