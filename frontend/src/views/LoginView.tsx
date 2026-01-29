import { useState } from 'react';

const LoginView = ({ onLogin }: { onLogin: () => void }) => {
    const [isScanning, setIsScanning] = useState(false);

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        setIsScanning(true);
        setTimeout(() => {
            onLogin();
        }, 2000);
    };

    return (
        <div className="fixed inset-0 bg-ghi-navy flex items-center justify-center p-6 overflow-hidden font-din">
            {/* Background Effects */}
            <div className="absolute inset-0 z-0 flex items-center justify-center overflow-hidden">
                <div className="absolute inset-0 bg-[linear-gradient(rgba(0,242,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,242,255,0.03)_1px,transparent_1px)] bg-[size:50px_50px]"></div>

                {/* Simplified Saudi Arabia SVG Map (Centralized) */}
                <div className="relative w-full h-full max-w-[1000px] max-h-[1000px] opacity-15 pointer-events-none transition-opacity duration-1000">
                    <svg
                        viewBox="0 0 1024 1024"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        className="w-full h-full drop-shadow-[0_0_15px_rgba(0,242,255,0.2)]"
                    >
                        <g transform="translate(0,1024) scale(0.1,-0.1)">
                            <path
                                d="M2199 9455 l-44 -44 -465 -136 c-256 -75 -475 -139 -488 -143 -22 -7 -7 -27 205 -268 125 -143 234 -267 241 -276 11 -14 3 -22 -66 -64 -79 -47 -79 -47 -117 -133 -21 -47 -42 -90 -47 -96 -5 -5 -88 -26 -184 -46 -96 -20 -176 -38 -178 -40 -2 -2 -32 -47 -67 -100 -45 -68 -92 -121 -160 -182 l-97 -87 -271 43 -272 44 -14 -27 c-18 -35 -54 -227 -64 -347 -9 -98 -48 -215 -95 -288 -17 -25 -16 -27 3 -58 l21 -32 0 26 c0 36 22 54 48 40 24 -13 99 -17 128 -7 45 16 199 -169 228 -273 14 -50 27 -72 76 -121 33 -34 63 -73 66 -88 12 -57 28 -84 76 -127 32 -29 53 -57 60 -81 5 -21 28 -59 51 -85 23 -27 69 -104 102 -171 59 -121 66 -129 141 -174 17 -10 18 -15 6 -48 -22 -59 8 -109 65 -111 16 0 89 -88 114 -137 10 -20 19 -48 19 -61 0 -14 17 -40 45 -67 44 -43 45 -46 45 -105 0 -79 -8 -105 -31 -105 -25 0 -24 -6 10 -49 48 -61 111 -167 111 -187 1 -46 57 -79 102 -60 11 5 23 1 35 -14 20 -24 124 -80 148 -80 8 0 32 -15 52 -33 21 -19 59 -48 85 -66 29 -19 50 -42 53 -56 3 -14 7 -36 10 -48 2 -13 29 -57 59 -98 41 -57 57 -89 69 -142 9 -43 25 -80 44 -102 63 -77 75 -95 61 -95 -8 0 -20 6 -27 13 -16 14 -16 16 33 -88 21 -44 44 -88 53 -97 8 -9 19 -34 23 -55 8 -31 6 -41 -11 -59 -21 -22 -49 -135 -49 -199 0 -24 8 -52 21 -70 11 -16 32 -55 45 -85 27 -58 27 -120 2 -175 -9 -20 -3 -38 43 -125 44 -84 60 -105 87 -117 27 -11 31 -17 22 -28 -8 -10 -6 -16 9 -27 11 -8 37 -46 58 -85 27 -49 55 -85 90 -112 46 -37 57 -41 106 -41 51 0 59 -3 103 -44 27 -24 76 -57 109 -74 50 -25 64 -38 82 -76 20 -40 27 -46 53 -46 16 0 30 -1 30 -2 0 -2 7 -21 14 -43 12 -34 12 -41 -1 -50 -12 -9 -6 -19 35 -57 40 -38 51 -57 66 -111 18 -67 36 -92 71 -99 20 -4 21 -8 8 -68 -3 -18 2 -31 16 -44 13 -12 21 -31 21 -52 0 -46 15 -81 38 -88 25 -8 68 -72 75 -112 3 -18 20 -53 37 -80 16 -26 30 -55 30 -65 0 -9 7 -22 15 -29 8 -6 26 -32 40 -57 19 -32 39 -50 69 -63 24 -10 53 -32 65 -49 12 -17 42 -44 65 -61 48 -32 76 -89 96 -191 10 -52 13 -56 35 -51 31 5 75 -40 75 -78 0 -18 10 -33 30 -48 36 -27 63 -86 55 -122 -4 -19 1 -32 20 -50 14 -13 25 -32 25 -42 0 -23 1 -23 59 6 53 27 81 62 81 101 0 21 5 25 31 25 33 0 33 4 3 79 -17 41 -17 60 -3 173 l12 88 47 35 c67 49 123 49 187 0 62 -47 115 -61 173 -46 25 7 52 19 61 27 10 9 38 14 80 14 66 0 135 -26 867 -326 l112 -46 0 -265 c0 -146 4 -263 9 -261 4 2 272 301 595 665 323 365 590 663 593 663 4 0 351 81 772 180 l766 181 741 261 741 260 157 514 c86 283 154 520 150 527 -20 35 -208 333 -216 342 -6 6 -14 3 -23 -9 -13 -18 -34 -16 -607 63 -326 45 -605 84 -619 87 -20 4 -84 78 -267 308 -210 264 -241 308 -244 342 -3 34 -8 41 -42 58 -32 16 -42 17 -59 7 -13 -9 -23 -9 -29 -3 -17 17 1 61 43 107 33 36 38 46 25 51 -8 3 -27 -3 -42 -15 -27 -21 -27 -21 -41 -1 -12 17 -21 19 -75 13 l-62 -6 -38 44 c-26 30 -46 44 -65 45 -21 0 -29 8 -39 35 -7 19 -13 44 -13 56 -1 12 -14 36 -31 53 -33 34 -38 47 -48 140 -7 62 -9 66 -45 85 -33 18 -137 123 -137 139 0 4 14 0 30 -9 17 -9 30 -13 30 -9 0 3 -13 22 -30 41 -16 18 -30 43 -30 55 0 11 -16 38 -35 59 -26 29 -35 48 -35 73 0 44 11 51 43 26 l25 -20 16 25 c9 14 16 45 16 72 0 43 -4 51 -44 88 -47 43 -62 79 -52 120 6 24 7 25 32 9 41 -28 38 -8 -6 40 -34 37 -49 46 -76 46 -18 0 -39 7 -46 16 -7 9 -34 39 -59 68 -25 28 -52 61 -58 74 -9 16 -18 21 -29 17 -44 -18 -48 -16 -72 35 -13 28 -39 65 -57 81 l-34 29 30 0 c37 0 44 11 25 38 -12 18 -25 22 -69 22 -44 0 -56 4 -65 20 -8 14 -21 20 -46 20 -28 0 -36 5 -44 26 -13 33 -13 77 0 69 6 -3 10 -16 11 -28 0 -19 2 -18 11 6 12 34 -3 61 -63 109 -56 45 -95 125 -104 213 -11 107 -6 105 -220 105 l-183 0 -26 34 c-14 19 -26 47 -26 62 0 15 -16 55 -35 89 l-34 62 -219 32 c-169 26 -224 31 -240 22 -11 -6 -38 -11 -59 -11 -47 0 -802 78 -811 84 -4 2 -292 240 -640 528 l-632 524 -163 72 c-145 64 -192 92 -398 234 -129 88 -243 164 -254 169 -11 4 -144 31 -295 59 -151 28 -280 53 -286 55 -6 2 -31 -16 -55 -40z"
                                className="stroke-ghi-teal/30 fill-ghi-teal/5"
                                strokeWidth="2"
                            />
                        </g>
                    </svg>
                </div>

                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-ghi-teal/5 blur-[120px] rounded-full"></div>
            </div>

            {/* Login Card */}
            <div className="relative z-10 w-full max-w-md animate-in fade-in zoom-in-95 duration-1000">
                <div className="glass-panel p-10 rounded-[2.5rem] border border-ghi-blue/20 shadow-2xl shadow-ghi-teal/5 text-center">
                    <div className="mb-8">
                        {/* System Logo */}
                        <div className="w-20 h-20 mx-auto mb-6 relative">
                            <div className="absolute inset-0 bg-ghi-teal/20 blur-xl rounded-full"></div>
                            <svg className="w-full h-full relative z-10" viewBox="0 0 48 48" fill="none">
                                <circle cx="24" cy="24" r="22" stroke="#00F2FF" strokeWidth="0.5" strokeDasharray="4 4" opacity="0.3" />
                                <circle cx="24" cy="24" r="18" stroke="#00F2FF" strokeWidth="1" opacity="0.5" />
                                <ellipse cx="24" cy="24" rx="18" ry="6" stroke="#00F2FF" strokeWidth="0.5" strokeDasharray="2 1" opacity="0.4" />
                                <ellipse cx="24" cy="24" rx="6" ry="18" stroke="#00F2FF" strokeWidth="0.5" strokeDasharray="2 1" opacity="0.4" />
                                <circle cx="24" cy="24" r="3" fill="#00F2FF" />
                                <circle cx="24" cy="24" r="1.5" fill="#00F2FF" className="animate-ping" />
                            </svg>
                        </div>
                        <h1 className="text-xl font-black tracking-[0.3em] text-ghi-teal uppercase mb-2">Global Health</h1>
                        <h2 className="text-xs font-black tracking-[0.6em] text-white uppercase opacity-60">Intelligence</h2>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-6">
                        <div className="space-y-4">
                            <div className="relative group">
                                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest absolute -top-2 left-4 bg-ghi-navy px-2 z-10">Email</label>
                                <input
                                    type="text"
                                    defaultValue="analyst@ghi.gov"
                                    className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-6 py-4 text-xs font-black tracking-widest text-white focus:ring-1 ring-ghi-teal outline-none transition-all"
                                />
                            </div>
                            <div className="relative group">
                                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest absolute -top-2 left-4 bg-ghi-navy px-2 z-10">Password</label>
                                <input
                                    type="password"
                                    defaultValue="••••••••"
                                    className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-6 py-4 text-xs font-black tracking-widest text-white focus:ring-1 ring-ghi-teal outline-none transition-all"
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            className="w-full py-5 bg-ghi-teal/10 hover:bg-ghi-teal/20 text-ghi-teal font-black text-[11px] uppercase tracking-[0.4em] rounded-2xl transition-all border border-ghi-teal/30 relative overflow-hidden group"
                        >
                            <span className={isScanning ? 'opacity-0' : 'opacity-100 transition-opacity'}>LOGIN</span>
                            {isScanning && (
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-full h-[2px] bg-ghi-teal animate-[scan_2s_infinite] shadow-[0_0_15px_#00F2FF]"></div>
                                    <span className="absolute inset-0 flex items-center justify-center text-[8px] animate-pulse">Syncing Neural Link...</span>
                                </div>
                            )}
                        </button>
                    </form>

                    <div className="mt-10 pt-8 border-t border-white/5 flex justify-between items-center text-[8px] font-black text-slate-600 uppercase tracking-widest">
                        <span>Only Authorised Access</span>
                        <div className="flex gap-4">
                            <span className="text-ghi-teal/40">Status: Optimal</span>
                            <span className="animate-pulse text-ghi-teal">LINK: BEACON</span>
                        </div>
                    </div>
                </div>
            </div>

            <style>{`
                @keyframes scan {
                    0% { transform: translateY(-30px); opacity: 0; }
                    50% { opacity: 1; }
                    100% { transform: translateY(30px); opacity: 0; }
                }
            `}</style>
        </div>
    );
};

export default LoginView;
