import { validateSummary } from "../../../../lib/jsos-domain";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = validateSummary(body);
    return Response.json(result, { status: result.ok ? 200 : 422 });
  } catch {
    return Response.json({ ok: false, errors: ["无法解析 JSON"] }, { status: 400 });
  }
}
