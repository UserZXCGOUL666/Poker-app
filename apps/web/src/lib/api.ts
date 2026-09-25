const API_URL = (import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:4000/api' : '/api')).replace(/\/$/, '');

export function apiAssetUrl(path: string) { return `${API_URL}${path}`; }

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('poker-club-token');
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(payload.message || 'Ошибка соединения с сервером', response.status);
  return payload as T;
}

export function post<T>(path: string, body?: unknown, method = 'POST') {
  return api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
}
