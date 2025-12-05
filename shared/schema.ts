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

// Dashboard Widget types
export const WIDGET_TYPES = [
  "client_stats",
  "recent_encounters",
  "upcoming_appointments",
  "audit_log_summary",
  "program_enrollment",
] as const;

export type WidgetType = typeof WIDGET_TYPES[number];

export type WidgetLayout = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type DashboardWidget = {
  id: string;
  userId: string;
  widgetType: WidgetType;
  title: string | null;
  layout: WidgetLayout;
  settings: Record<string, any> | null;
  createdAt: Date;
  updatedAt: Date;
};

export const insertWidgetSchema = z.object({
  widgetType: z.enum(WIDGET_TYPES),
  title: z.string().optional(),
  layout: z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(8),
  }),
  settings: z.record(z.any()).optional(),
});

export const updateWidgetSchema = z.object({
  title: z.string().optional(),
  layout: z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(8),
  }).optional(),
  settings: z.record(z.any()).optional(),
});

export const batchUpdateLayoutSchema = z.array(z.object({
  id: z.string(),
  layout: z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(8),
  }),
}));

export type InsertWidget = z.infer<typeof insertWidgetSchema>;
export type UpdateWidget = z.infer<typeof updateWidgetSchema>;
export type BatchUpdateLayout = z.infer<typeof batchUpdateLayoutSchema>;
