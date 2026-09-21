const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://api.fromzerotohero.io/api";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, payload.error ?? "Richiesta non riuscita");
  return payload as T;
}

export const api = {
  session: () => request<unknown>("/session"),
  stats: () => request<{ count: number }>("/stats/users"),
  plans: () => request<unknown>("/plans"),
  login: (body: { email: string; password: string; service: string }) => request<unknown>("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  register: (body: Record<string, string>) => request<unknown>("/register", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request<unknown>("/auth/logout", { method: "POST" })
};
