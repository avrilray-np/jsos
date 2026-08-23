import { getServerConfig } from "./server-config";

export async function supabaseAuth(path: string, init: RequestInit = {}) {
  const config = getServerConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) throw new Error("Supabase 尚未配置");
  return fetch(`${config.supabaseUrl}/auth/v1/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", apikey: config.supabaseAnonKey, ...(init.headers ?? {}) },
  });
}

export async function supabaseAdmin(path: string, init: RequestInit = {}) {
  const config = getServerConfig();
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) throw new Error("Supabase 尚未配置");
  return fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: config.supabaseServiceRoleKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      ...(init.headers ?? {}),
    },
  });
}

export async function supabaseUser(path: string, accessToken: string, init: RequestInit = {}) {
  const config = getServerConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) throw new Error("Supabase 尚未配置");
  return fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  });
}

export async function supabaseStorage(path: string, init: RequestInit = {}) {
  const config = getServerConfig();
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) throw new Error("Supabase 尚未配置");
  return fetch(`${config.supabaseUrl}/storage/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.supabaseServiceRoleKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      ...(init.headers ?? {}),
    },
  });
}
