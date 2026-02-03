import { useState, useEffect } from 'react';
import { fetchUsers, createUser, updateUser } from '../lib/api';

const UserManagement = () => {
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);
    const [editingUser, setEditingUser] = useState<any>(null);

    const [newUser, setNewUser] = useState({
        username: '',
        email: '',
        fullName: '',
        password: '',
        role: 'Analyst',
        permissions: {
            dashboard: 'view',
            listener: 'view',
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
                    listener: 'view',
                    triage: 'view',
                    assessment: 'view',
                    escalation: 'view'
                }
            });
        } catch (err) {
            alert('Failed to create user. Ensure email is @pha.gov.sa');
        }
    };

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await updateUser(editingUser.id, editingUser);
            setEditingUser(null);
            loadUsers();
        } catch (err) {
            alert('Failed to update member credentials.');
        }
    };

    if (loading) return <div className="text-ghi-teal animate-pulse font-black text-center p-20 uppercase tracking-[0.3em]">Querying Personnel Database...</div>;

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
            <div className="flex justify-between items-center">
                <h3 className="text-xl font-black text-white uppercase tracking-widest leading-none">Personnel Directory</h3>
                <button
                    onClick={() => { setShowAddForm(!showAddForm); setEditingUser(null); }}
                    className="px-6 py-2 bg-ghi-teal/10 hover:bg-ghi-teal/20 text-ghi-teal text-[11px] font-black tracking-[0.2em] rounded-xl transition-all border border-ghi-teal/30 uppercase"
                >
                    {showAddForm ? 'Cancel Operation' : 'Add New Member'}
                </button>
            </div>

            {/* Editing Modal */}
            {editingUser && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-ghi-navy/90 backdrop-blur-xl">
                    <div className="glass-panel w-full max-w-2xl p-10 rounded-[2.5rem] border border-ghi-teal/30 shadow-2xl shadow-ghi-teal/10 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-ghi-teal/40 to-transparent"></div>

                        <div className="flex justify-between items-center mb-10">
                            <div>
                                <h3 className="text-xl font-black text-white uppercase tracking-widest">Update Credentials</h3>
                                <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest mt-1">Modifying Directive ID: {editingUser.username}</p>
                            </div>
                            <button onClick={() => setEditingUser(null)} className="text-slate-500 hover:text-white transition-colors">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>

                        <form onSubmit={handleUpdate} className="grid grid-cols-1 md:grid-cols-2 gap-10">
                            <div className="space-y-6">
                                <div>
                                    <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Full Identity</label>
                                    <input
                                        required
                                        className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-5 py-3 text-sm text-white focus:border-ghi-teal outline-none transition-all font-black tracking-widest"
                                        value={editingUser.fullName}
                                        onChange={e => setEditingUser({ ...editingUser, fullName: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">System Email</label>
                                    <input
                                        required
                                        type="email"
                                        className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-5 py-3 text-sm text-white focus:border-ghi-teal outline-none transition-all font-black tracking-widest"
                                        value={editingUser.email}
                                        onChange={e => setEditingUser({ ...editingUser, email: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Update Password (Leave blank to keep current)</label>
                                    <input
                                        type="password"
                                        placeholder="••••••••"
                                        className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-5 py-3 text-sm text-white focus:border-ghi-teal outline-none transition-all font-black tracking-widest"
                                        onChange={e => setEditingUser({ ...editingUser, password: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Access Level</label>
                                    <select
                                        className="w-full bg-slate-900 border border-white/10 rounded-xl px-5 py-3 text-sm text-ghi-teal focus:border-ghi-teal outline-none transition-all font-black appearance-none"
                                        value={editingUser.role}
                                        onChange={e => setEditingUser({ ...editingUser, role: e.target.value })}
                                    >
                                        <option value="Analyst" className="bg-slate-900 text-white">ANALYST</option>
                                        <option value="Director" className="bg-slate-900 text-white">DIRECTOR</option>
                                        <option value="Superadmin" className="bg-slate-900 text-white">SUPERADMIN</option>
                                        <option value="Admin" className="bg-slate-900 text-white">ADMIN</option>
                                    </select>
                                </div>
                                <div className="pt-4">
                                    <button className="w-full py-4 bg-ghi-teal/20 text-ghi-teal font-black text-[11px] tracking-[0.4em] rounded-2xl hover:bg-ghi-teal/30 transition-all uppercase border border-ghi-teal/30">
                                        Commit Changes
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-4 pt-2">
                                <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1 block underline underline-offset-8 decoration-ghi-teal/30">Privilege Matrix</label>
                                {Object.keys(editingUser.permissions || {}).map((key) => (
                                    <div key={key} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5">
                                        <span className="text-[11px] font-black text-white uppercase tracking-widest">{key}</span>
                                        <select
                                            className="bg-ghi-navy border-white/20 text-[11px] font-black text-ghi-teal rounded-lg px-3 py-1 outline-none"
                                            value={(editingUser.permissions as any)[key]}
                                            onChange={e => setEditingUser({
                                                ...editingUser,
                                                permissions: {
                                                    ...editingUser.permissions,
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
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {showAddForm && (
                <div className="glass-panel p-8 rounded-3xl border border-ghi-teal/20 animate-in zoom-in-95 duration-300">
                    <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-4">
                            <div>
                                <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Full Name</label>
                                <input
                                    required
                                    className="w-full bg-ghi-navy border border-white/10 rounded-xl px-4 py-2.5 text-white focus:border-ghi-teal outline-none transition-all"
                                    value={newUser.fullName}
                                    onChange={e => setNewUser({ ...newUser, fullName: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Username</label>
                                <input
                                    required
                                    className="w-full bg-ghi-navy border border-white/10 rounded-xl px-4 py-2.5 text-white focus:border-ghi-teal outline-none transition-all"
                                    value={newUser.username}
                                    onChange={e => setNewUser({ ...newUser, username: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">PHA Email Address</label>
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
                                <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Terminal Password</label>
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
                            <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block underline underline-offset-4">Granular Permissions</label>
                            {Object.keys(newUser.permissions).map((key) => (
                                <div key={key} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                                    <span className="text-[11px] font-black text-white uppercase tracking-widest">{key}</span>
                                    <select
                                        className="bg-ghi-navy border-white/20 text-[11px] font-black text-ghi-teal rounded-lg px-3 py-1 outline-none"
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
                            <button className="w-full mt-4 py-3 bg-ghi-teal/20 text-ghi-teal font-black text-[11px] tracking-[0.2em] rounded-xl hover:bg-ghi-teal/30 transition-all uppercase">
                                Authorize Member
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Mobile Cards View */}
            <div className="grid grid-cols-1 gap-4 md:hidden pb-10">
                {users.map(user => (
                    <div key={user.id} className="glass-panel p-6 rounded-3xl border border-ghi-blue/10 relative overflow-hidden group">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="w-12 h-12 rounded-2xl bg-ghi-teal/10 flex items-center justify-center text-ghi-teal font-black text-sm border border-ghi-teal/20">
                                {user.fullName.split(' ').map((n: string) => n[0]).join('')}
                            </div>
                            <div className="flex-1 min-w-0">
                                <h4 className="text-white font-black text-sm uppercase tracking-widest truncate">{user.fullName}</h4>
                                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mt-0.5">ID: {user.username}</p>
                            </div>
                            <button
                                onClick={() => setEditingUser(user)}
                                className="p-3 rounded-xl bg-white/[0.05] border border-white/5 text-ghi-teal hover:bg-ghi-teal/10 transition-all"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-5M16.138 2.376a2.25 2.25 0 013.182 3.182L10.334 14.54a1.125 1.125 0 01-.482.287l-2.731.796.796-2.731a1.125 1.125 0 01.287-.482L16.138 2.376z" /></svg>
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="flex justify-between items-center py-3 border-y border-white/5">
                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Network Authority</span>
                                <span className="px-3 py-1 rounded-full bg-ghi-teal/10 text-ghi-teal text-[10px] font-black uppercase tracking-widest border border-ghi-teal/20">
                                    {user.role}
                                </span>
                            </div>

                            <div className="flex justify-between items-center">
                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Email Domain</span>
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest truncate max-w-[150px]">{user.email}</span>
                            </div>

                            <div className="pt-2">
                                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Access Matrix</p>
                                <div className="flex flex-wrap gap-2">
                                    {Object.entries(user.permissions || {}).map(([key, val]) => (
                                        <div key={key} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/5">
                                            <span className={`w-2 h-2 rounded-full ${val === 'edit' ? 'bg-ghi-teal' : val === 'update' ? 'bg-ghi-warning' : 'bg-slate-700'}`}></span>
                                            <span className="text-[9px] font-black text-white uppercase tracking-tighter">{key}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Desktop View Table */}
            <div className="hidden md:block glass-panel overflow-hidden rounded-[2.5rem] border border-ghi-blue/10">
                <table className="w-full text-left">
                    <thead>
                        <tr className="bg-ghi-teal/5 border-b border-white/5">
                            <th className="px-8 py-5 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Personnel</th>
                            <th className="px-8 py-5 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Email Domain</th>
                            <th className="px-8 py-5 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">System Role</th>
                            <th className="px-8 py-5 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Matrix</th>
                            <th className="px-8 py-5 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {users.map(user => (
                            <tr key={user.id} className="group hover:bg-white/[0.02] transition-colors">
                                <td className="px-8 py-6">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-full bg-ghi-teal/10 flex items-center justify-center text-ghi-teal font-black text-xs border border-ghi-teal/10 group-hover:border-ghi-teal/40 transition-all duration-500">
                                            {user.fullName.split(' ').map((n: string) => n[0]).join('')}
                                        </div>
                                        <div>
                                            <p className="text-white font-black text-xs uppercase tracking-widest">{user.fullName}</p>
                                            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mt-0.5">ID: {user.username}</p>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-8 py-6 text-[11px] font-black text-slate-400 uppercase tracking-widest">{user.email}</td>
                                <td className="px-8 py-6">
                                    <span className="px-3 py-1 rounded-full bg-ghi-teal/10 text-ghi-teal text-[10px] font-black uppercase tracking-widest border border-ghi-teal/20">
                                        {user.role}
                                    </span>
                                </td>
                                <td className="px-8 py-6">
                                    <div className="flex gap-2">
                                        {Object.entries(user.permissions || {}).map(([key, val]) => (
                                            <div key={key} className="group/perm relative">
                                                <span className={`w-2 h-2 rounded-full inline-block ${val === 'edit' ? 'bg-ghi-teal shadow-[0_0_8px_#00F2FF]' : val === 'update' ? 'bg-ghi-warning shadow-[0_0_8px_#FFD700]' : 'bg-slate-700'}`}></span>
                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-ghi-navy border border-white/10 rounded text-[10px] font-black text-white whitespace-nowrap opacity-0 group-hover/perm:opacity-100 transition-opacity uppercase tracking-widest z-50 backdrop-blur-md">
                                                    {key}: {val as any}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </td>
                                <td className="px-8 py-6 text-right">
                                    <button
                                        onClick={() => setEditingUser(user)}
                                        className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5 hover:border-ghi-teal/50 text-slate-500 hover:text-ghi-teal transition-all group/edit"
                                    >
                                        <svg className="w-4 h-4 group-hover/edit:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-5M16.138 2.376a2.25 2.25 0 013.182 3.182L10.334 14.54a1.125 1.125 0 01-.482.287l-2.731.796.796-2.731a1.125 1.125 0 01.287-.482L16.138 2.376z" /></svg>
                                    </button>
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
