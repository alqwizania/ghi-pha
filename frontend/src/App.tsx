import { useState, useEffect } from 'react';
import Dashboard from './views/Dashboard';
import Triage from './views/Triage';
import AssessmentView from './views/AssessmentView';
import EscalationView from './views/EscalationView';
import LoginView from './views/LoginView';
import UserManagement from './views/UserManagement';

const GHICLogo = () => (
  <div className="relative flex items-center justify-center group">
    <div className="absolute inset-0 bg-ghi-teal/20 blur-2xl rounded-full opacity-40 group-hover:opacity-100 transition-opacity duration-700"></div>
    <svg className="w-10 h-10 lg:w-16 lg:h-16 relative z-10" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="0.5" className="stroke-ghi-teal/30" strokeDasharray="4 4" opacity="0.4" />
      <circle cx="24" cy="24" r="18" stroke="currentColor" strokeWidth="1" className="stroke-ghi-teal/50" />
      <ellipse cx="24" cy="24" rx="18" ry="6" stroke="currentColor" strokeWidth="0.5" className="stroke-ghi-teal/40" strokeDasharray="2 1" />
      <ellipse cx="24" cy="24" rx="6" ry="18" stroke="currentColor" strokeWidth="0.5" className="stroke-ghi-teal/40" strokeDasharray="2 1" />
      <circle cx="24" cy="24" r="3" className="fill-ghi-teal" />
      <circle cx="24" cy="24" r="1.5" className="fill-ghi-teal animate-ping" />
    </svg>
  </div>
);

const UserIcon = () => (
  <svg className="w-5 h-5 lg:w-6 lg:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
);

const DashboardIcon = () => (
  <svg className="w-5 h-5 lg:w-6 lg:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM14 11a1 1 0 011-1h4a1 1 0 011 1v8a1 1 0 01-1 1h-4a1 1 0 01-1-1v-8z"></path></svg>
);

const TriageIcon = () => (
  <svg className="w-5 h-5 lg:w-6 lg:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
);

const AssessmentIcon = () => (
  <svg className="w-5 h-5 lg:w-6 lg:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
);

const EscalationIcon = () => (
  <svg className="w-5 h-5 lg:w-6 lg:h-6 text-ghi-critical" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
);

function App() {
  const [user, setUser] = useState<any>(null);
  const [activeView, setActiveView] = useState(() => {
    const path = window.location.pathname.replace('/', '');
    return path || 'dashboard';
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.replace('/', '');
      setActiveView(path || 'dashboard');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (view: string) => {
    setActiveView(view);
    setIsSidebarOpen(false);
    window.history.pushState({}, '', `/${view}`);
  };

  if (!user) {
    return <LoginView onLogin={(userData) => setUser(userData)} />;
  }

  const navItems = [
    { id: 'dashboard', label: 'DASHBOARD', icon: <DashboardIcon /> },
    { id: 'triage', label: 'TRIAGE', icon: <TriageIcon /> },
    { id: 'assessments', label: 'ASSESSMENTS', icon: <AssessmentIcon /> },
    { id: 'escalations', label: 'ESCALATIONS', icon: <EscalationIcon /> },
  ];

  const canSeePersonnel = user.role === 'Director' || user.role === 'Superadmin' || user.role === 'Admin';
  if (canSeePersonnel) {
    navItems.push({ id: 'users', label: 'PERSONNEL', icon: <UserIcon /> });
  }

  const handleLogout = () => {
    setUser(null);
    window.history.pushState({}, '', '/');
  };

  return (
    <div className="flex h-screen w-screen bg-ghi-navy text-slate-100 overflow-hidden font-din flex-col lg:flex-row">
      {/* Mobile Header */}
      <header className="lg:hidden flex items-center justify-between px-6 py-4 bg-ghi-navy/50 backdrop-blur-md border-b border-white/5 z-50">
        <div className="flex items-center gap-3">
          <GHICLogo />
          <span className="text-[10px] font-black tracking-widest text-white uppercase ml-4">{activeView}</span>
        </div>
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="p-2 text-ghi-teal hover:bg-ghi-teal/10 rounded-lg transition-colors"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={isSidebarOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
          </svg>
        </button>
      </header>

      {/* Sidebar / Overlay */}
      <aside className={`
        fixed inset-0 z-40 lg:relative lg:inset-auto
        w-full lg:w-64 glass-panel flex flex-col border-r border-ghi-blue/10
        transition-transform duration-500 lg:translate-x-0
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="hidden lg:flex p-8 flex-col items-center gap-4 border-b border-ghi-blue/10">
          <GHICLogo />
          <div className="text-center mt-2">
            <h1 className="text-xs font-black tracking-[0.2em] text-ghi-teal uppercase">Global Health</h1>
            <h2 className="text-[10px] text-white font-black tracking-[0.4em] uppercase opacity-70">Intelligence</h2>
          </div>
        </div>

        {/* Mobile Sidebar Logo */}
        <div className="lg:hidden p-10 flex flex-col items-center gap-4 border-b border-white/5 bg-ghi-navy/30">
          <GHICLogo />
        </div>

        <nav className="flex-1 mt-8 px-4 space-y-2 overflow-y-auto">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              className={`group w-full flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-300 ${activeView === item.id
                ? 'sidebar-link-active neon-border'
                : 'text-slate-500 hover:text-ghi-teal hover:bg-ghi-teal/5'
                }`}
            >
              <div className={`${activeView === item.id ? 'text-ghi-teal' : 'text-slate-500 group-hover:text-ghi-teal'}`}>
                {item.icon}
              </div>
              <span className="text-[10px] font-bold tracking-widest uppercase">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 lg:p-6 border-t border-ghi-blue/10">
          <button
            onClick={handleLogout}
            className="w-full text-left group transition-all"
          >
            <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-ghi-critical/10 hover:border-ghi-critical/30 transition-all">
              <div className="w-10 h-10 rounded-xl bg-ghi-blue/20 flex items-center justify-center text-ghi-teal font-black text-xs border border-ghi-teal/20 group-hover:border-ghi-critical/50 transition-all">
                {user.fullName.split(' ').map((n: string) => n[0]).join('')}
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="text-[10px] font-black text-white uppercase truncate group-hover:text-ghi-critical transition-colors">{user.fullName}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-ghi-success shadow-[0_0_8px_rgba(57,255,20,0.5)]"></span>
                  <p className="text-[9px] text-slate-500 uppercase font-black tracking-tighter">{user.role}</p>
                </div>
              </div>
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                <svg className="w-4 h-4 text-ghi-critical" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              </div>
            </div>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-ghi-navy p-4 lg:p-8 relative flex flex-col min-h-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,_rgba(0,242,255,0.05)_0%,_transparent_50%)] pointer-events-none"></div>

        <header className="hidden lg:flex justify-between items-center mb-10 relative z-10 shrink-0">
          <div>
            <h2 className="text-2xl font-black text-white tracking-widest uppercase mb-1">{activeView}</h2>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-ghi-teal shadow-[0_0_8px_#00F2FF]"></div>
              <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">Neural Link: <span className="text-ghi-teal">Active</span></p>
            </div>
          </div>

          <div className="flex gap-6">
            {/* Empty space or future dynamic alerts */}
          </div>
        </header>

        {/* View Content */}
        <div className="relative z-10 flex-1 h-full">
          {activeView === 'dashboard' && <Dashboard />}
          {activeView === 'triage' && <Triage user={user} />}
          {activeView === 'assessments' && <AssessmentView user={user} />}
          {activeView === 'escalations' && <EscalationView />}
          {activeView === 'users' && <UserManagement />}
        </div>
      </main>
    </div>
  );
}

export default App;
