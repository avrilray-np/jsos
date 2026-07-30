import { getServerConfig, isCloudConfigured } from "./server-config";
import { supabaseAuth } from "./supabase-rest";

export const ACCESS_COOKIE = "jsos_access_token";
export const REFRESH_COOKIE = "jsos_refresh_token";

type SupabaseUser = { id: string; email?: string };
type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user?: SupabaseUser;
};

export type JsosSession = {
  userId: string;
  email: string;
  accessToken: string;
};

export function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key === name) return decodeURIComponent(valueParts.join("="));
  }
  return "";
}

export async function getRequestSession(request: Request): Promise<JsosSession | null> {
  if (!isCloudConfigured()) return null;
  const accessToken = readCookie(request, ACCESS_COOKIE);
  if (!accessToken) return null;
  const response = await supabaseAuth("user", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const user = await response.json() as SupabaseUser;
  return normalizeSession(user, accessToken);
}

export async function refreshRequestSession(request: Request): Promise<{ session: JsosSession; tokens: TokenResponse } | null> {
  if (!isCloudConfigured()) return null;
  const refreshToken = readCookie(request, REFRESH_COOKIE);
  if (!refreshToken) return null;
  const response = await supabaseAuth("token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!response.ok) return null;
  const tokens = await response.json() as TokenResponse;
  let user = tokens.user;
  if (!user) {
    const userResponse = await supabaseAuth("user", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!userResponse.ok) return null;
    user = await userResponse.json() as SupabaseUser;
  }
  const session = normalizeSession(user, tokens.access_token);
  return session ? { session, tokens } : null;
}

function normalizeSession(user: SupabaseUser, accessToken: string): JsosSession | null {
  const email = user.email?.trim().toLowerCase() ?? "";
  const allowedEmail = getServerConfig().allowedEmail;
  if (!user.id || !email || !allowedEmail || email !== allowedEmail) return null;
  return { userId: user.id, email, accessToken };
}

export function appendSessionCookies(headers: Headers, request: Request, tokens: TokenResponse) {
  const secure = request.headers.get("x-forwarded-proto") === "https" || new URL(request.url).protocol === "https:";
  const security = secure ? "; Secure" : "";
  headers.append("Set-Cookie", `${ACCESS_COOKIE}=${encodeURIComponent(tokens.access_token)}; HttpOnly${security}; SameSite=Lax; Path=/; Max-Age=${tokens.expires_in}`);
  headers.append("Set-Cookie", `${REFRESH_COOKIE}=${encodeURIComponent(tokens.refresh_token)}; HttpOnly${security}; SameSite=Lax; Path=/; Max-Age=2592000`);
}

export function appendClearedSessionCookies(headers: Headers, request: Request) {
  const secure = request.headers.get("x-forwarded-proto") === "https" || new URL(request.url).protocol === "https:";
  const security = secure ? "; Secure" : "";
  headers.append("Set-Cookie", `${ACCESS_COOKIE}=; HttpOnly${security}; SameSite=Lax; Path=/; Max-Age=0`);
  headers.append("Set-Cookie", `${REFRESH_COOKIE}=; HttpOnly${security}; SameSite=Lax; Path=/; Max-Age=0`);
}
