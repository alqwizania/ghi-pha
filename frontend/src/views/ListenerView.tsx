import { useState, useEffect } from 'react';
import { fetchSocialSignals, promoteSocialSignal, dismissSocialSignal, fetchMonitoredAccounts } from '../lib/api';

const MetricCard = ({ label, value, color }: { label: string; value: number; color: string }) => (
    <div className="glass-panel p-5 rounded-2xl border border-white/5 hover:border-ghi-teal/20 transition-all duration-500">
        <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.2em] mb-2">{label}</p>
        <h3 className={`text-3xl font-black ${color} tracking-tighter`}>{value}</h3>
    </div>
);

const SocialSignalCard = ({ signal, onPromote, onDismiss }: any) => {
    const [showPromoteModal, setShowPromoteModal] = useState(false);
    const [disease, setDisease] = useState('');
    const [country, setCountry] = useState('');

    const isCritical = parseFloat(signal.relevanceScore) > 85;
    const isHigh = parseFloat(signal.relevanceScore) > 70;

    const handlePromote = async () => {
        await onPromote(signal.id, { disease, country });
        setShowPromoteModal(false);
    };

    return (
        <>
            <div className={`relative group p-5 rounded-2xl bg-white/[0.03] border transition-all duration-500 overflow-hidden ${isCritical ? 'border-ghi-critical/30 hover:border-ghi-critical/50' : 'border-white/5 hover:border-ghi-teal/30'}`}>
                {isCritical && <div className="absolute inset-0 bg-ghi-critical/5 animate-pulse"></div>}

                <div className="flex justify-between items-start mb-3 relative z-10">
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isCritical ? 'bg-ghi-critical animate-ping' : isHigh ? 'bg-ghi-warning' : 'bg-ghi-teal'}`}></div>
                        <span className="text-[10px] font-black text-white uppercase tracking-widest">{signal.author}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`text-xs font-black ${isCritical ? 'text-ghi-critical' : isHigh ? 'text-ghi-warning' : 'text-ghi-teal'}`}>{signal.relevanceScore}%</span>
                        <span className="text-[9px] font-bold text-slate-600 uppercase">{signal.language.toUpperCase()}</span>
                    </div>
                </div>

                <p className={`text-sm text-white mb-3 leading-relaxed ${signal.language === 'ar' ? 'text-right' : 'text-left'}`}>
                    {signal.content}
                </p>

                <div className="flex flex-wrap gap-1 mb-3">
                    {Array.isArray(signal.hashtags) && signal.hashtags.map((tag: string, i: number) => (
                        <span key={i} className="text-[9px] px-2 py-1 rounded-lg bg-ghi-teal/10 text-ghi-teal border border-ghi-teal/20 font-black">
                            #{tag}
                        </span>
                    ))}
                </div>

                <div className="flex justify-between items-center border-t border-white/5 pt-3 relative z-10">
                    <div className="flex items-center gap-4 text-[9px] font-bold text-slate-500 uppercase">
                        <span>❤️ {(signal.engagement as any)?.likes || 0}</span>
                        <span>🔄 {(signal.engagement as any)?.retweets || 0}</span>
                        <span>💬 {(signal.engagement as any)?.replies || 0}</span>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setShowPromoteModal(true)}
                            className="px-3 py-1.5 rounded-lg bg-ghi-teal/10 hover:bg-ghi-teal/20 border border-ghi-teal/20 text-[9px] font-black text-ghi-teal uppercase tracking-widest transition-all"
                        >
                            Promote
                        </button>
                        <button
                            onClick={() => onDismiss(signal.id)}
                            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[9px] font-black text-slate-400 uppercase tracking-widest transition-all"
                        >
                            Dismiss
                        </button>
                    </div>
                </div>
            </div>

            {/* Promote Modal */}
            {showPromoteModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="glass-panel p-8 rounded-3xl border border-ghi-teal/30 max-w-lg w-full">
                        <h3 className="text-xl font-black text-white uppercase tracking-widest mb-6">Promote to Signal</h3>

                        <div className="space-y-4 mb-6">
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Disease Name</label>
                                <input
                                    type="text"
                                    value={disease}
                                    onChange={(e) => setDisease(e.target.value)}
                                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white font-bold focus:border-ghi-teal/50 focus:outline-none"
                                    placeholder="e.g., H5N1, Cholera, MERS"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Country/Location</label>
                                <input
                                    type="text"
                                    value={country}
                                    onChange={(e) => setCountry(e.target.value)}
                                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white font-bold focus:border-ghi-teal/50 focus:outline-none"
                                    placeholder="e.g., Saudi Arabia, Yemen"
                                />
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={handlePromote}
                                className="flex-1 px-4 py-3 rounded-xl bg-ghi-teal/20 hover:bg-ghi-teal/30 border border-ghi-teal/50 text-sm font-black text-ghi-teal uppercase tracking-widest transition-all"
                            >
                                Confirm Promote
                            </button>
                            <button
                                onClick={() => setShowPromoteModal(false)}
                                className="flex-1 px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-black text-slate-400 uppercase tracking-widest transition-all"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

const ListenerView = ({ user }: any) => {
    const [signals, setSignals] = useState<any[]>([]);
    const [accounts, setAccounts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedAccount, setSelectedAccount] = useState<string>('all');
    const [selectedLanguage, setSelectedLanguage] = useState<string>('all');

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const [signalsData, accountsData] = await Promise.all([
                fetchSocialSignals(),
                fetchMonitoredAccounts()
            ]);
            setSignals(signalsData);
            setAccounts(accountsData);
        } catch (error) {
            console.error('Failed to load listener data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handlePromote = async (id: string, data: any) => {
        try {
            await promoteSocialSignal(id, { ...data, userId: user.id });
            await loadData();
        } catch (error) {
            console.error('Failed to promote signal:', error);
        }
    };

    const handleDismiss = async (id: string) => {
        try {
            await dismissSocialSignal(id);
            await loadData();
        } catch (error) {
            console.error('Failed to dismiss signal:', error);
        }
    };

    const filteredSignals = signals.filter(s => {
        if (selectedAccount !== 'all' && s.authorHandle !== selectedAccount) return false;
        if (selectedLanguage !== 'all' && s.language !== selectedLanguage) return false;
        return true;
    });

    const metrics = {
        total: signals.length,
        critical: signals.filter(s => parseFloat(s.relevanceScore) > 85).length,
        high: signals.filter(s => parseFloat(s.relevanceScore) > 70 && parseFloat(s.relevanceScore) <= 85).length,
        promoted: signals.filter(s => s.verificationStatus === 'Promoted').length,
    };

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <div className="text-ghi-teal font-black animate-pulse uppercase tracking-[0.3em]">Initializing Social Listener...</div>
        </div>
    );

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000 pb-10">
            {/* Metrics Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard label="Total Signals" value={metrics.total} color="text-ghi-teal" />
                <MetricCard label="Critical" value={metrics.critical} color="text-ghi-critical" />
                <MetricCard label="High Priority" value={metrics.high} color="text-ghi-warning" />
                <MetricCard label="Promoted" value={metrics.promoted} color="text-ghi-success" />
            </div>

            {/* Main Content */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
                {/* Filters Sidebar */}
                <div className="xl:col-span-3 space-y-6">
                    <div className="glass-panel p-6 rounded-2xl border border-white/5">
                        <h3 className="text-xs font-black text-white uppercase tracking-[0.3em] mb-4 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-ghi-teal"></span>
                            Filters
                        </h3>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Account</label>
                                <select
                                    value={selectedAccount}
                                    onChange={(e) => setSelectedAccount(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm font-bold focus:border-ghi-teal/50 focus:outline-none"
                                >
                                    <option value="all">All Accounts</option>
                                    {accounts.map(acc => (
                                        <option key={acc.id} value={acc.accountHandle}>{acc.accountHandle}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Language</label>
                                <select
                                    value={selectedLanguage}
                                    onChange={(e) => setSelectedLanguage(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm font-bold focus:border-ghi-teal/50 focus:outline-none"
                                >
                                    <option value="all">All Languages</option>
                                    <option value="en">English</option>
                                    <option value="ar">Arabic</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Priority Accounts */}
                    <div className="glass-panel p-6 rounded-2xl border border-white/5">
                        <h3 className="text-xs font-black text-white uppercase tracking-[0.3em] mb-4">Priority Accounts</h3>
                        <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                            {accounts.filter(a => a.priority === 1).map(acc => (
                                <div key={acc.id} className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/5">
                                    <div className="w-1.5 h-1.5 rounded-full bg-ghi-teal"></div>
                                    <span className="text-[10px] font-black text-white">{acc.accountHandle}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Social Feed */}
                <div className="xl:col-span-9">
                    <div className="glass-panel p-6 rounded-2xl border border-white/5">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-sm font-black text-white uppercase tracking-[0.3em]">Live Social Feed</h3>
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-ghi-teal animate-ping"></div>
                                <span className="text-[9px] font-black text-ghi-teal uppercase tracking-widest">Monitoring Active</span>
                            </div>
                        </div>

                        <div className="space-y-4 max-h-[800px] overflow-y-auto custom-scrollbar pr-2">
                            {filteredSignals.length > 0 ? (
                                filteredSignals.map(signal => (
                                    <SocialSignalCard
                                        key={signal.id}
                                        signal={signal}
                                        onPromote={handlePromote}
                                        onDismiss={handleDismiss}
                                    />
                                ))
                            ) : (
                                <div className="py-20 text-center border border-dashed border-white/5 rounded-2xl">
                                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em]">No social signals match filters</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <style>{`
                .custom-scrollbar::-webkit-scrollbar { width: 2px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0, 242, 255, 0.1); border-radius: 10px; }
            `}</style>
        </div>
    );
};

export default ListenerView;
