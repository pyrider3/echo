CREATE INDEX `idx_agents_created_at` ON `agents` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_messages_agent_created` ON `messages` (`agent_id`,`created_at`);