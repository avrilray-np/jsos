export const FEEDBACK_BODY_MAX = 500;
export const FEEDBACK_IMAGE_MAX_COUNT = 5;
export const FEEDBACK_ORIGINAL_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const FEEDBACK_STORED_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export function validateFeedbackBody(value: unknown) {
  const body = typeof value === "string" ? value.trim() : "";
  if (!body) return { ok: false as const, message: "请填写反馈内容" };
  if (body.length > FEEDBACK_BODY_MAX) return { ok: false as const, message: `反馈内容不能超过 ${FEEDBACK_BODY_MAX} 字` };
  return { ok: true as const, body };
}

export function feedbackErrorMessage(message = "") {
  if (message.includes("daily feedback limit reached")) return "今天已提交 10 次反馈，请明天再试";
  if (message.includes("feedback length invalid")) return "反馈内容需为 1～500 字";
  if (message.includes("too many images")) return "最多上传 5 张图片";
  return "反馈提交失败，请稍后重试";
}
