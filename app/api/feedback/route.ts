import { getRequestSession } from "../../../lib/auth-session";
import {
  FEEDBACK_IMAGE_MAX_COUNT,
  FEEDBACK_ORIGINAL_IMAGE_MAX_BYTES,
  FEEDBACK_STORED_IMAGE_MAX_BYTES,
  feedbackErrorMessage,
  validateFeedbackBody,
} from "../../../lib/feedback-domain";
import { isCloudConfigured } from "../../../lib/server-config";
import { supabaseStorage, supabaseUser } from "../../../lib/supabase-rest";

type FeedbackRow = {
  id: string;
  user_email: string;
  body: string;
  image_paths: string[];
  status: "unread" | "read";
  created_at: string;
  read_at: string | null;
};

export async function GET(request: Request) {
  if (!isCloudConfigured()) return Response.json({ ok: false, code: "SETUP_REQUIRED" }, { status: 503 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ ok: false, message: "请重新登录" }, { status: 401 });
  if (!session.isAdmin) return Response.json({ ok: false, message: "无权查看反馈" }, { status: 403 });
  const response = await supabaseUser(
    "feedback?select=id,user_email,body,image_paths,status,created_at,read_at&order=created_at.desc&limit=200",
    session.accessToken,
  );
  if (!response.ok) return Response.json({ ok: false, message: "读取反馈失败" }, { status: 502 });
  const feedback = await response.json() as FeedbackRow[];
  return Response.json({ ok: true, feedback, unreadCount: feedback.filter((item) => item.status === "unread").length });
}

export async function POST(request: Request) {
  if (!isCloudConfigured()) return Response.json({ ok: false, code: "SETUP_REQUIRED" }, { status: 503 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ ok: false, message: "请重新登录" }, { status: 401 });

  const form = await request.formData();
  const validated = validateFeedbackBody(form.get("body"));
  if (!validated.ok) return Response.json({ ok: false, message: validated.message }, { status: 422 });
  const images = form.getAll("images").filter((item): item is File => item instanceof File && item.size > 0);
  if (images.length > FEEDBACK_IMAGE_MAX_COUNT) return Response.json({ ok: false, message: "最多上传 5 张图片" }, { status: 422 });
  const originalSizes = parseOriginalSizes(form.get("originalSizes"), images.length);
  if (!originalSizes || originalSizes.some((size) => size > FEEDBACK_ORIGINAL_IMAGE_MAX_BYTES)) {
    return Response.json({ ok: false, message: "每张原图不能超过 10 MB" }, { status: 422 });
  }
  if (images.some((file) => file.size > FEEDBACK_STORED_IMAGE_MAX_BYTES)) {
    return Response.json({ ok: false, message: "图片压缩后仍超过 2 MB，请换一张图片" }, { status: 422 });
  }
  if (images.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
    return Response.json({ ok: false, message: "仅支持 JPG、PNG、WebP 图片" }, { status: 422 });
  }

  const groupId = crypto.randomUUID();
  const uploaded: string[] = [];
  try {
    for (const [index, file] of images.entries()) {
      const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const path = `${session.userId}/${groupId}/${index + 1}.${extension}`;
      const upload = await supabaseStorage(`object/feedback-images/${path}`, {
        method: "POST",
        headers: { "Content-Type": file.type, "x-upsert": "false" },
        body: await file.arrayBuffer(),
      });
      if (!upload.ok) throw new Error("image upload failed");
      uploaded.push(path);
    }
    const response = await supabaseUser("rpc/submit_jsos_feedback", session.accessToken, {
      method: "POST",
      body: JSON.stringify({ p_body: validated.body, p_image_paths: uploaded }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(error?.message ?? "feedback submit failed");
    }
    return Response.json({ ok: true, message: "反馈已提交，谢谢你" });
  } catch (error) {
    await Promise.all(uploaded.map((path) => supabaseStorage(`object/feedback-images/${path}`, { method: "DELETE" }).catch(() => null)));
    const message = error instanceof Error ? error.message : "";
    return Response.json({ ok: false, message: feedbackErrorMessage(message) }, { status: 502 });
  }
}

function parseOriginalSizes(value: FormDataEntryValue | null, count: number) {
  try {
    const sizes = JSON.parse(typeof value === "string" ? value : "[]") as unknown;
    if (!Array.isArray(sizes) || sizes.length !== count || sizes.some((size) => typeof size !== "number" || size < 0)) return null;
    return sizes as number[];
  } catch {
    return null;
  }
}
