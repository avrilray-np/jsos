import { getRequestSession } from "../../../../lib/auth-session";
import { isCloudConfigured } from "../../../../lib/server-config";
import { supabaseStorage, supabaseUser } from "../../../../lib/supabase-rest";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isCloudConfigured()) return Response.json({ ok: false, code: "SETUP_REQUIRED" }, { status: 503 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ ok: false, message: "请重新登录" }, { status: 401 });
  if (!session.isAdmin) return Response.json({ ok: false, message: "无权处理反馈" }, { status: 403 });
  const { id } = await context.params;
  const response = await supabaseUser(`feedback?id=eq.${encodeURIComponent(id)}`, session.accessToken, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "read", read_at: new Date().toISOString() }),
  });
  if (!response.ok) return Response.json({ ok: false, message: "标记失败" }, { status: 502 });
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isCloudConfigured()) return Response.json({ ok: false, code: "SETUP_REQUIRED" }, { status: 503 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ ok: false, message: "请重新登录" }, { status: 401 });
  if (!session.isAdmin) return Response.json({ ok: false, message: "无权删除反馈" }, { status: 403 });
  const { id } = await context.params;
  const read = await supabaseUser(`feedback?select=image_paths&id=eq.${encodeURIComponent(id)}&limit=1`, session.accessToken);
  if (!read.ok) return Response.json({ ok: false, message: "读取反馈失败" }, { status: 502 });
  const [row] = await read.json() as Array<{ image_paths: string[] }>;
  if (!row) return Response.json({ ok: false, message: "反馈不存在" }, { status: 404 });
  const storageResults = await Promise.all((row.image_paths ?? []).map((path) => supabaseStorage(`object/feedback-images/${path}`, { method: "DELETE" })));
  if (storageResults.some((response) => !response.ok && response.status !== 404)) {
    return Response.json({ ok: false, message: "图片删除失败，请稍后重试" }, { status: 502 });
  }
  const remove = await supabaseUser(`feedback?id=eq.${encodeURIComponent(id)}`, session.accessToken, { method: "DELETE" });
  if (!remove.ok) return Response.json({ ok: false, message: "删除反馈失败" }, { status: 502 });
  return Response.json({ ok: true });
}
