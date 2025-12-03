import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean, serial, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Chapter model - policy chapters that users need to acknowledge
export const chapters = pgTable("chapters", {
  id: serial("id").primaryKey(),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  section: text("section").notNull(),
  slug: text("slug").notNull().unique(),
  body: text("body").notNull(),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertChapterSchema = createInsertSchema(chapters).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateChapterSchema = insertChapterSchema.partial();

export type InsertChapter = z.infer<typeof insertChapterSchema>;
export type UpdateChapter = z.infer<typeof updateChapterSchema>;
export type Chapter = typeof chapters.$inferSelect;

// User model - staff members who need to acknowledge policies
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("staff"), // admin, director, staff
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastLogin: timestamp("last_login"),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  lastLogin: true,
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type SafeUser = Omit<User, "passwordHash">;

// PolicyAcknowledgement - tracks which users have acknowledged which chapters
export const policyAcknowledgements = pgTable("policy_acknowledgements", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  chapterId: integer("chapter_id").notNull().references(() => chapters.id),
  version: integer("version").notNull(),
  acknowledgedAt: timestamp("acknowledged_at").notNull().defaultNow(),
});

export const insertAcknowledgementSchema = createInsertSchema(policyAcknowledgements).omit({
  id: true,
  acknowledgedAt: true,
});

export type InsertAcknowledgement = z.infer<typeof insertAcknowledgementSchema>;
export type PolicyAcknowledgement = typeof policyAcknowledgements.$inferSelect;
