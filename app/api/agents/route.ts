import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { agents } from "../../../db/schema";

export async function GET() {
  const rows = await getDb().select().from(agents).orderBy(desc(agents.createdAt));
  return Response.json({ agents: rows });
}

export async function POST(request: Request) {
  const body = await request.json() as { name?: string; relation?: string; chatLog?: string; voiceEnabled?: boolean; modelMode?: "fast" | "pro" };
  const name = body.name?.trim();
  const chatLog = body.chatLog?.trim();
  if (!name || !chatLog || chatLog.length < 20) return Response.json({ error: "称呼和有效聊天记录不能为空" }, { status: 400 });
  const [agent] = await getDb().insert(agents).values({ name, relation: body.relation?.trim() || "重要的人", chatLog, voiceEnabled: Boolean(body.voiceEnabled), modelMode: body.modelMode === "pro" ? "pro" : "fast" }).returning();
  return Response.json({ agent }, { status: 201 });
}
