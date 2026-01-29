

const SignalCard = ({ signal }: any) => (
    <div className={`glass-panel p-8 rounded-3xl border border-white/5 relative overflow-hidden transition-all duration-500 hover:border-ghi-blue/30 group ${signal.priority > 85 ? 'pulse-critical ring-1 ring-ghi-critical/20' : ''}`}>
        <div className="absolute top-0 right-0 w-32 h-32 bg-ghi-teal/5 blur-3xl rounded-full -mr-16 -mt-16 group-hover:bg-ghi-teal/10 transition-all"></div>

        <div className="flex justify-between items-start mb-6 relative z-10">
            <div>
                <span className={`px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-[0.2em] ${signal.priority > 85 ? 'bg-ghi-critical/10 text-ghi-critical border border-ghi-critical/20 shadow-[0_0_10px_rgba(255,49,49,0.1)]' : 'bg-ghi-warning/10 text-ghi-warning border border-ghi-warning/20'
                    }`}>
                    {signal.priority > 85 ? 'Biohazard Critical' : 'Priority Assessment'}
                </span>
                <h3 className="text-2xl font-black text-white mt-4 uppercase tracking-wider">{signal.disease}</h3>
                <div className="flex items-center gap-2 mt-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-500"></div>
                    <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">{signal.country} // {signal.location}</p>
                </div>
            </div>
            <div className="text-right">
                <p className="text-slate-500 text-[9px] font-black uppercase tracking-widest mb-1">Impact Score</p>
                <p className="text-3xl font-black text-ghi-teal neon-text">{signal.priority}<span className="text-[10px] text-slate-600 ml-1">/100</span></p>
            </div>
        </div>

        <div className="grid grid-cols-3 gap-6 mb-6 py-5 border-y border-white/5 relative z-10">
            <div>
                <p className="text-slate-500 text-[9px] uppercase font-black tracking-widest mb-1">Reported Cases</p>
                <p className="text-white font-black text-lg">{signal.cases}</p>
            </div>
            <div>
                <p className="text-slate-500 text-[9px] uppercase font-black tracking-widest mb-1">Confirmed Deaths</p>
                <p className="text-white font-black text-lg">{signal.deaths}</p>
            </div>
            <div>
                <p className="text-slate-500 text-[9px] uppercase font-black tracking-widest mb-1">Fatal Ratio</p>
                <p className="text-ghi-critical font-black text-lg">{signal.cfr}%</p>
            </div>
        </div>

        <p className="text-slate-400 text-xs mb-8 line-clamp-3 leading-relaxed font-medium italic relative z-10">
            "{signal.description}"
        </p>

        <div className="flex gap-4 relative z-10">
            <button className="flex-1 px-5 py-3 bg-white/5 hover:bg-ghi-critical/10 text-slate-400 hover:text-ghi-critical text-[10px] font-black tracking-[0.2em] rounded-xl transition-all border border-white/5 hover:border-ghi-critical/30 uppercase">
                REJECT INTEL
            </button>
            <button className="flex-1 px-5 py-3 bg-ghi-teal/10 hover:bg-ghi-teal/20 text-ghi-teal text-[10px] font-black tracking-[0.2em] rounded-xl transition-all border border-ghi-teal/30 hover:shadow-[0_0_20px_rgba(0,242,255,0.15)] uppercase">
                INITIATE RESPONSE
            </button>
            <button className="px-5 py-3 glass-panel hover:bg-white/5 text-slate-500 hover:text-white text-[10px] font-black tracking-[0.2em] rounded-xl transition-all border border-white/10 uppercase">
                SOURCE
            </button>
        </div>
    </div>
);

const Triage = () => {
    const mockSignals = [
        {
            id: 1,
            disease: 'Ebola Virus Disease',
            country: 'DRC',
            location: 'North Kivu',
            priority: 89,
            cases: 12,
            deaths: 5,
            cfr: 41.7,
            description: 'Health authorities report a cluster of cases in North Kivu. Samples sent to Kinshasa for confirmation. Transmission vectors identified in urban centers.'
        },
        {
            id: 2,
            disease: 'Cholera Outbreak',
            country: 'Yemen',
            location: 'Taiz Governorate',
            priority: 74,
            cases: 145,
            deaths: 3,
            cfr: 2.1,
            description: 'Rapid increase in acute watery diarrhea cases reported. Lack of clean water infrastructure suspected. Multiple districts exceeding threshold limits.'
        },
        {
            id: 3,
            disease: 'MERS-CoV Cluster',
            country: 'Saudi Arabia',
            location: 'Riyadh Central',
            priority: 92,
            cases: 8,
            deaths: 2,
            cfr: 25,
            description: 'Nosocomial transmission confirmed in a Riyadh hospital. Healthcare workers among the infected. Emergency quarantine protocols engaged.'
        }
    ];

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
            <div className="flex justify-between items-center bg-ghi-teal/5 p-4 rounded-2xl border border-ghi-teal/10">
                <div className="flex gap-4">
                    <select className="bg-ghi-navy border-white/10 text-[10px] font-black tracking-widest text-slate-400 rounded-xl px-4 py-2 focus:ring-1 ring-ghi-teal transition-all outline-none uppercase">
                        <option>ALL DISEASES</option>
                        <option>EBOLA</option>
                        <option>CHOLERA</option>
                    </select>
                    <select className="bg-ghi-navy border-white/10 text-[10px] font-black tracking-widest text-slate-400 rounded-xl px-4 py-2 focus:ring-1 ring-ghi-teal transition-all outline-none uppercase">
                        <option>ALL REGIONS</option>
                        <option>DRC</option>
                        <option>YEMEN</option>
                    </select>
                </div>
                <div className="px-4 py-2 rounded-xl bg-ghi-navy/50 border border-white/5">
                    <p className="text-slate-500 text-[9px] font-black tracking-widest uppercase">Intel Queue: <span className="text-ghi-teal neon-text">{mockSignals.length} Active Signals</span></p>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                {mockSignals.map(s => <SignalCard key={s.id} signal={s} />)}
            </div>
        </div>
    );
};

export default Triage;
