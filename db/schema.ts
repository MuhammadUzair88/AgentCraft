
import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  agentCredits:integer('agentCredits').default(3),
  usageCredits:integer('usageCredits').default(100),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const googleConnections = pgTable("google_connections", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  email: text("email").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const agentConfig = pgTable("agentConfig", {
  id: serial("id").primaryKey(),
  email: text("email").references(() => users.email),
  agentId: varchar("agentId").notNull().unique(),
  name: varchar("name"),
  agentImage: varchar("agentImage"),
  description: text("description"),
  instructions: text("instructions"),
  objective: text("objective"),
  tools: jsonb("tools").$type<string[]>(),
  skills: jsonb("skills").$type<string[]>(),
  schedule: jsonb("schedule").$type<{ type: "once" | "recurring"; frequency: string; time: string }>(),
  outputFormat: text("outputFormat"),
  status: varchar("status").default("active"),
  composioSessionId: varchar("composioSessionId"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const agentRun = pgTable("agentRun", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: varchar("agentId").notNull().references(() => agentConfig.agentId),
  email: text("email").notNull(),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  timezone: varchar("timezone", { length: 100 }).notNull(),
  status: varchar("status").default("scheduled").notNull(),
  output: jsonb("output").$type<Record<string, unknown>>(),
  error: text("error"),
  queuedAt: timestamp("queued_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});


export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const tools = pgTable("tools", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 150 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 100 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  provider: varchar("provider", { length: 100 }).notNull(),
  icon: text("icon"),
  status: varchar("status", { length: 50 }).default("active"),
  requiresAuth: boolean("requires_auth").default(false),
  authType: varchar("auth_type", { length: 50 }),
  authProvider: varchar("auth_provider", { length: 100 }),
  capabilities: jsonb("capabilities").default(sql`'[]'::jsonb`),
  useCases: jsonb("use_cases").default(sql`'[]'::jsonb`),
  permissions: jsonb("permissions").default(sql`'[]'::jsonb`),
  approvalRules: jsonb("approval_rules"),
  config: jsonb("config"),
  riskLevel: varchar("risk_level", { length: 30 }).default("low"),
  canRead: boolean("can_read").default(false),
  canWrite: boolean("can_write").default(false),
  canDelete: boolean("can_delete").default(false),
  canExecute: boolean("can_execute").default(true),
  enabled: boolean("enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type Tool = typeof tools.$inferSelect;
export type NewTool = typeof tools.$inferInsert;
