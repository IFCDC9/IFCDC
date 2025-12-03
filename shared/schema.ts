import { z } from "zod";

// Chapter types
export type Chapter = {
  id: number;
  number: number;
  title: string;
  section: string;
  slug: string;
  body: string;
  version: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export const insertChapterSchema = z.object({
  number: z.number().int().min(1),
  title: z.string().min(1),
  section: z.string().min(1),
  slug: z.string().min(1),
  body: z.string().min(1),
  version: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const updateChapterSchema = insertChapterSchema.partial();

export type InsertChapter = z.infer<typeof insertChapterSchema>;
export type UpdateChapter = z.infer<typeof updateChapterSchema>;

// User types
export type User = {
  id: number;
  name: string;
  email: string;
  passwordHash: string;
  role: string;
  isActive: boolean;
  lastLogin: Date | null;
};

export type SafeUser = Omit<User, "passwordHash">;

export const insertUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  passwordHash: z.string().min(1),
  role: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type InsertUser = z.infer<typeof insertUserSchema>;

// PolicyAcknowledgement types
export type PolicyAcknowledgement = {
  id: number;
  userId: number;
  chapterId: number;
  version: number;
  acknowledgedAt: Date;
};

export const insertAcknowledgementSchema = z.object({
  userId: z.number().int(),
  chapterId: z.number().int(),
  version: z.number().int(),
});

export type InsertAcknowledgement = z.infer<typeof insertAcknowledgementSchema>;
