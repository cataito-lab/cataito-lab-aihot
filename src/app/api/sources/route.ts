import { listSources } from "@/lib/news";

export async function GET() {
  try {
    const sources = await listSources();
    return Response.json({ sources });
  } catch (err) {
    console.error("[api/sources]", err);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
