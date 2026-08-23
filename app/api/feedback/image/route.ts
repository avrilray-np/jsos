import { getRequestSession } from "../../../../lib/auth-session";
import { isCloudConfigured } from "../../../../lib/server-config";
import { supabaseStorage } from "../../../../lib/supabase-rest";

export async function GET(request: Request) {
  if (!isCloudConfigured()) return new Response(null, { status: 503 });
  const session = await getRequestSession(request);
  if (!session) return new Response(null, { status: 401 });
  if (!session.isAdmin) return new Response(null, { status: 403 });
  const path = new URL(request.url).searchParams.get("path") ?? "";
  if (!path || path.includes("..") || path.startsWith("/")) return new Response(null, { status: 400 });
  const response = await supabaseStorage(`object/authenticated/feedback-images/${path}`);
  if (!response.ok || !response.body) return new Response(null, { status: 404 });
  return new Response(response.body, {
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "image/jpeg",
      "Cache-Control": "private, max-age=300",
    },
  });
}
