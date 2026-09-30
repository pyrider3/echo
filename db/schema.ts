import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const agents = sqliteTable("agents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  relation: text("relation").notNull().default("重要的人"),
  chatLog: text("chat_log").notNull(),
  voiceEnabled: integer("voice_enabled", { mode: "boolean" }).notNull().default(false),
  modelMode: text("model_mode", { enum: ["fast", "pro"] }).notNull().default("fast"),
  status: text("status").notNull().default("ready"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [index("idx_agents_created_at").on(table.createdAt)]);

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: integer("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [index("idx_messages_agent_created").on(table.agentId, table.createdAt)]);
