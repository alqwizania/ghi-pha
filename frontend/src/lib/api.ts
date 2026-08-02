export const API_BASE_URL = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' && window.location.hostname === 'localhost' ? 'http://localhost:8787' : 'https://ghi-core.rads-pha.workers.dev');
export const API_URL = API_BASE_URL;

const SESSION_KEY = 'ghi_session';

function sessionToken(): string | null {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        return raw ? (JSON.parse(raw).token ?? null) : null;
    } catch {
        return null;
    }
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const token = sessionToken();
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

/**
 * All API traffic goes through here so a rejected session is handled in one
 * place: an expired or forged token drops the operator back to the login
 * screen rather than leaving the UI showing stale data it can no longer refresh.
 */
async function request(path: string, init: RequestInit = {}, errorMessage = 'Request failed') {
    const response = await fetch(`${API_URL}${path}`, {
        ...init,
        headers: authHeaders(init.headers as Record<string, string> | undefined),
    });

    if (response.status === 401) {
        localStorage.removeItem(SESSION_KEY);
        window.location.reload();
        throw new Error('Session expired');
    }

    if (!response.ok) throw new Error(errorMessage);
    return response.json();
}

const jsonBody = (data: unknown): RequestInit => ({
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
});

export async function login(email: string, password: string) {
    const response = await fetch(`${API_URL}/api/v1/auth/login`, {
        method: 'POST',
        ...jsonBody({ email, password }),
    });
    if (!response.ok) throw new Error('Login failed');
    return response.json();
}

export async function fetchSignals() {
    return request('/api/v1/signals', {}, 'Failed to fetch signals');
}

export async function fetchAssessments() {
    return request('/api/v1/assessments', {}, 'Failed to fetch assessments');
}

export async function fetchEscalations() {
    return request('/api/v1/escalations', {}, 'Failed to fetch escalations');
}

export async function fetchUsers() {
    return request('/api/v1/users', {}, 'Failed to fetch users');
}

export async function createUser(userData: any) {
    return request('/api/v1/users', { method: 'POST', ...jsonBody(userData) }, 'Failed to create user');
}

export async function updateUser(id: string, userData: any) {
    return request(`/api/v1/users/${id}`, { method: 'PUT', ...jsonBody(userData) }, 'Failed to update user');
}

export async function acceptSignal(id: string) {
    return request(`/api/v1/signals/${id}/accept`, { method: 'POST' }, 'Failed to accept signal');
}

export async function rejectSignal(id: string) {
    return request(`/api/v1/signals/${id}/reject`, { method: 'POST' }, 'Failed to reject signal');
}

export async function updateAssessment(id: string, data: any) {
    return request(`/api/v1/assessments/${id}`, { method: 'PUT', ...jsonBody(data) }, 'Failed to update assessment');
}

export async function escalateAssessment(id: string, data: any) {
    return request(`/api/v1/assessments/${id}/escalate`, { method: 'POST', ...jsonBody(data) }, 'Failed to escalate assessment');
}

// --- SOCIAL LISTENER ---

export async function fetchSocialSignals() {
    return request('/api/v1/social-signals', {}, 'Failed to fetch social signals');
}

export async function promoteSocialSignal(id: string, data: any) {
    return request(`/api/v1/social-signals/${id}/promote`, { method: 'POST', ...jsonBody(data) }, 'Failed to promote social signal');
}

export async function dismissSocialSignal(id: string) {
    return request(`/api/v1/social-signals/${id}/dismiss`, { method: 'POST' }, 'Failed to dismiss social signal');
}

export async function fetchMonitoredAccounts() {
    return request('/api/v1/monitored-accounts', {}, 'Failed to fetch monitored accounts');
}

export async function fetchListenerKeywords() {
    return request('/api/v1/listener-keywords', {}, 'Failed to fetch listener keywords');
}

// --- GLOBAL RADAR ---

export async function fetchRadarEvents() {
    return request('/api/radar/events', {}, 'Failed to fetch radar events');
}

export async function fetchRadarSources() {
    return request('/api/radar/sources', {}, 'Failed to fetch radar sources');
}

export async function triggerRadarScan() {
    return request('/api/radar/scan', { method: 'POST' }, 'Radar scan failed');
}

export async function promoteRadarEvent(eventId: string) {
    return request('/api/radar/promote', { method: 'POST', ...jsonBody({ eventId }) }, 'Failed to promote radar event');
}
