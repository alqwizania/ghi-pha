import { useState, useEffect } from 'react';
import { fetchUsers, createUser } from '../lib/api';

const UserManagement = () => {
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);
    const [newUser, setNewUser] = useState({
        username: '',
        email: '',
        fullName: '',
        password: '',
        role: 'Analyst',
        permissions: {
            dashboard: 'view',
            triage: 'view',
            assessment: 'view',
            escalation: 'view'
        }
    });

    useEffect(() => {
        loadUsers();
    }, []);

    const loadUsers = async () => {
        try {
            const data = await fetchUsers();
            setUsers(data);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await createUser(newUser);
            setShowAddForm(false);
            loadUsers();
            setNewUser({
                username: '',
                email: '',
                fullName: '',
                password: '',
                role: 'Analyst',
                permissions: {
                    dashboard: 'view',
                    triage: 'view',
                    assessment: 'view',
                    escalation: 'view'
                }
            });
        } catch (err) {
            alert('Failed to create user. Ensure email is @pha.gov.sa');
        }
    };

    if (loading) return <div className="text-ghi-teal animate-pulse font-black text-center p-20 uppercase tracking-[0.3em]">Querying Personnel Database...</div>;

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
            <div className="flex justify-between items-center">
                <h3 className="text-xl font-black text-white uppercase tracking-widest">Personnel Directory</h3>
                <button
                    onClick={() => setShowAddForm(!showAddForm)}
                    className="px-6 py-2 bg-ghi-teal/10 hover:bg-ghi-teal/20 text-ghi-teal text-[10px] font-black tracking-[0.2em] rounded-xl transition-all border border-ghi-teal/30 uppercase"
                >
                    {showAddForm ? 'Cancel Operation' : 'Add New Member'}
                </button>
            </div>

            {showAddForm && (
                <div className="glass-panel p-8 rounded-3xl border border-ghi-teal/20 animate-in zoom-in-95 duration-300">
                    <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-4">
                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Full Name</label>
                                <input
                                    required
                                    className="w-full bg-ghi-navy border border-white/10 rounded-xl px-4 py-2.5 text-white focus:border-ghi-teal outline-none transition-all"
                                    value={newUser.fullName}
                                    onChange={e => setNewUser({ ...newUser, fullName: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Username</label>
                                <input
                                    required
                                    className="w-full bg-ghi-navy border border-white/10 rounded-xl px-4 py-2.5 text-white focus:border-ghi-teal outline-none transition-all"
                                    value={newUser.username}
                                    onChange={e => setNewUser({ ...newUser, username: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">PHA Email Address</label>
                                <input
                                    required
                                    type="email"
                                    placeholder="user@pha.gov.sa"
                                    className="w-full bg-ghi-navy border border-white/10 rounded-xl px-4 py-2.5 text-white focus:border-ghi-teal outline-none transition-all"
                                    value={newUser.email}
                                    onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Terminal Password</label>
                                <input
                                    required
                                    type="password"
                                    className="w-full bg-ghi-navy border border-white/10 rounded-xl px-4 py-2.5 text-white focus:border-ghi-teal outline-none transition-all"
                                    value={newUser.password}
                                    onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="space-y-4">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block underline underline-offset-4">Granular Permissions</label>
                            {Object.keys(newUser.permissions).map((key) => (
                                <div key={key} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                                    <span className="text-[10px] font-black text-white uppercase tracking-widest">{key}</span>
                                    <select
                                        className="bg-ghi-navy border-white/20 text-[10px] font-black text-ghi-teal rounded-lg px-3 py-1 outline-none"
                                        value={(newUser.permissions as any)[key]}
                                        onChange={e => setNewUser({
                                            ...newUser,
                                            permissions: {
                                                ...newUser.permissions,
                                                [key]: e.target.value
                                            }
                                        })}
                                    >
                                        <option value="view">VIEW ONLY</option>
                                        <option value="edit">EDIT ACCESS</option>
                                        <option value="update">UPDATE ACCESS</option>
                                    </select>
                                </div>
                            ))}
                            <button className="w-full mt-4 py-3 bg-ghi-teal/20 text-ghi-teal font-black text-[10px] tracking-[0.2em] rounded-xl hover:bg-ghi-teal/30 transition-all uppercase">
                                Authorize Member
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <div className="glass-panel overflow-hidden rounded-[2.5rem] border border-ghi-blue/10">
                <table className="w-full text-left">
                    <thead>
                        <tr className="bg-ghi-teal/5 border-b border-white/5">
                            <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Personnel</th>
                            <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Email Domain</th>
                            <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">System Role</th>
                            <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Permissions</th>
                            <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {users.map(user => (
                            <tr key={user.id} className="group hover:bg-white/[0.02] transition-colors">
                                <td className="px-8 py-6">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-full bg-ghi-teal/10 flex items-center justify-center text-ghi-teal font-black text-xs">
                                            {user.fullName.split(' ').map((n: string) => n[0]).join('')}
                                        </div>
                                        <div>
                                            <p className="text-white font-black text-xs uppercase tracking-widest">{user.fullName}</p>
                                            <p className="text-slate-500 text-[9px] font-bold">ID: {user.username}</p>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">{user.email}</td>
                                <td className="px-8 py-6">
                                    <span className="px-3 py-1 rounded-full bg-ghi-teal/10 text-ghi-teal text-[8px] font-black uppercase tracking-widest border border-ghi-teal/20">
                                        {user.role}
                                    </span>
                                </td>
                                <td className="px-8 py-6">
                                    <div className="flex gap-2">
                                        {Object.entries(user.permissions || {}).map(([key, val]) => (
                                            <div key={key} className="group/perm relative">
                                                <span className={`w-2 h-2 rounded-full inline-block ${val === 'edit' ? 'bg-ghi-teal' : val === 'update' ? 'bg-ghi-warning' : 'bg-slate-700'}`}></span>
                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-ghi-navy border border-white/10 rounded text-[8px] font-black text-white whitespace-nowrap opacity-0 group-hover/perm:opacity-100 transition-opacity uppercase tracking-widest">
                                                    {key}: {val as any}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </td>
                                <td className="px-8 py-6">
                                    <div className="flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-ghi-success shadow-[0_0_8px_#39FF14]"></span>
                                        <span className="text-[9px] font-black text-ghi-success uppercase tracking-widest">Authorized</span>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default UserManagement;
