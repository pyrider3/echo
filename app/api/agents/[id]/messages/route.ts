import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { agents, messages } from "../../../../../db/schema";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const agentId = Number(id);
  const rows = await getDb().select().from(messages).where(eq(messages.agentId, agentId)).orderBy(asc(messages.createdAt));
  return Response.json({ messages: rows });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const agentId = Number(id);
  const body = await request.json() as { role?: "user" | "assistant"; content?: string };
  const content = body.content?.trim();
  if (!content || !["user", "assistant"].includes(body.role || "")) return Response.json({ error: "消息格式无效" }, { status: 400 });
  const [agent] = await getDb().select({ id: agents.id }).from(agents).where(and(eq(agents.id, agentId), eq(agents.status, "ready"))).limit(1);
  if (!agent) return Response.json({ error: "智能体不存在" }, { status: 404 });
  const [message] = await getDb().insert(messages).values({ agentId, role: body.role!, content }).returning();
  return Response.json({ message }, { status: 201 });
}
