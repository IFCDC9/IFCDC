import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import type { User, Chapter, PolicyAcknowledgement, Form, FormSubmission } from "../generated/prisma/client";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

export type SafeUser = Pick<User, "id" | "name" | "email" | "role" | "createdAt" | "updatedAt">;

export type InsertUser = {
  name?: string;
  email: string;
  passwordHash: string;
  role?: string;
};

export type InsertChapter = {
  number: number;
  title: string;
  section: string;
  slug: string;
  body: string;
  version?: number;
  isActive?: boolean;
};

export type UpdateChapter = Partial<InsertChapter>;

export type InsertAcknowledgement = {
  userId: string;
  chapterId: number;
  version: number;
};

export type InsertForm = {
  slug: string;
  title: string;
  schema: unknown;
  active?: boolean;
};

export type UpdateForm = Partial<InsertForm>;

export type InsertFormSubmission = {
  formId: number;
  submittedById?: string;
  data: unknown;
};

export interface IStorage {
  getUser(id: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<SafeUser[]>;

  getAllChapters(): Promise<Chapter[]>;
  getActiveChapters(): Promise<Chapter[]>;
  getChapter(id: number): Promise<Chapter | null>;
  getChapterBySlug(slug: string): Promise<Chapter | null>;
  createChapter(chapter: InsertChapter): Promise<Chapter>;
  updateChapter(id: number, chapter: UpdateChapter): Promise<Chapter | null>;
  deleteChapter(id: number): Promise<boolean>;

  getAcknowledgement(userId: string, chapterId: number): Promise<PolicyAcknowledgement | null>;
  getUserAcknowledgements(userId: string): Promise<PolicyAcknowledgement[]>;
  getChapterAcknowledgements(chapterId: number): Promise<PolicyAcknowledgement[]>;
  createAcknowledgement(ack: InsertAcknowledgement): Promise<PolicyAcknowledgement>;
  getAcknowledgementStats(): Promise<{ chapterId: number; count: number }[]>;

  getAllForms(): Promise<Form[]>;
  getActiveForms(): Promise<Form[]>;
  getForm(id: number): Promise<Form | null>;
  getFormBySlug(slug: string): Promise<Form | null>;
  createForm(form: InsertForm): Promise<Form>;
  updateForm(id: number, form: UpdateForm): Promise<Form | null>;
  deleteForm(id: number): Promise<boolean>;

  getFormSubmissions(formId: number): Promise<FormSubmission[]>;
  getUserFormSubmissions(submittedById: string): Promise<FormSubmission[]>;
  createFormSubmission(submission: InsertFormSubmission): Promise<FormSubmission>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  }

  async getUserByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    return prisma.user.create({
      data: {
        email: insertUser.email,
        passwordHash: insertUser.passwordHash,
        name: insertUser.name,
        role: insertUser.role ?? "user",
      },
    });
  }

  async getAllUsers(): Promise<SafeUser[]> {
    return prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async getAllChapters(): Promise<Chapter[]> {
    return prisma.chapter.findMany({ orderBy: { number: "asc" } });
  }

  async getActiveChapters(): Promise<Chapter[]> {
    return prisma.chapter.findMany({
      where: { isActive: true },
      orderBy: { number: "asc" },
    });
  }

  async getChapter(id: number): Promise<Chapter | null> {
    return prisma.chapter.findUnique({ where: { id } });
  }

  async getChapterBySlug(slug: string): Promise<Chapter | null> {
    return prisma.chapter.findUnique({ where: { slug } });
  }

  async createChapter(chapter: InsertChapter): Promise<Chapter> {
    return prisma.chapter.create({ data: chapter });
  }

  async updateChapter(id: number, chapter: UpdateChapter): Promise<Chapter | null> {
    try {
      return await prisma.chapter.update({ where: { id }, data: chapter });
    } catch {
      return null;
    }
  }

  async deleteChapter(id: number): Promise<boolean> {
    try {
      await prisma.chapter.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  async getAcknowledgement(userId: string, chapterId: number): Promise<PolicyAcknowledgement | null> {
    return prisma.policyAcknowledgement.findFirst({
      where: { userId, chapterId },
      orderBy: { acknowledgedAt: "desc" },
    });
  }

  async getUserAcknowledgements(userId: string): Promise<PolicyAcknowledgement[]> {
    return prisma.policyAcknowledgement.findMany({
      where: { userId },
      orderBy: { acknowledgedAt: "desc" },
    });
  }

  async getChapterAcknowledgements(chapterId: number): Promise<PolicyAcknowledgement[]> {
    return prisma.policyAcknowledgement.findMany({
      where: { chapterId },
      orderBy: { acknowledgedAt: "desc" },
    });
  }

  async createAcknowledgement(ack: InsertAcknowledgement): Promise<PolicyAcknowledgement> {
    return prisma.policyAcknowledgement.create({ data: ack });
  }

  async getAcknowledgementStats(): Promise<{ chapterId: number; count: number }[]> {
    const stats = await prisma.policyAcknowledgement.groupBy({
      by: ["chapterId"],
      _count: { userId: true },
    });
    return stats.map((s) => ({ chapterId: s.chapterId, count: s._count.userId }));
  }

  async getAllForms(): Promise<Form[]> {
    return prisma.form.findMany({ orderBy: { createdAt: "desc" } });
  }

  async getActiveForms(): Promise<Form[]> {
    return prisma.form.findMany({
      where: { active: true },
      orderBy: { title: "asc" },
    });
  }

  async getForm(id: number): Promise<Form | null> {
    return prisma.form.findUnique({ where: { id } });
  }

  async getFormBySlug(slug: string): Promise<Form | null> {
    return prisma.form.findUnique({ where: { slug } });
  }

  async createForm(form: InsertForm): Promise<Form> {
    return prisma.form.create({ data: { ...form, schema: form.schema as object } });
  }

  async updateForm(id: number, form: UpdateForm): Promise<Form | null> {
    try {
      const data: Record<string, unknown> = { ...form };
      if (form.schema !== undefined) data.schema = form.schema as object;
      return await prisma.form.update({ where: { id }, data: data as Parameters<typeof prisma.form.update>[0]["data"] });
    } catch {
      return null;
    }
  }

  async deleteForm(id: number): Promise<boolean> {
    try {
      await prisma.form.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  async getFormSubmissions(formId: number): Promise<FormSubmission[]> {
    return prisma.formSubmission.findMany({
      where: { formId },
      orderBy: { createdAt: "desc" },
    });
  }

  async getUserFormSubmissions(submittedById: string): Promise<FormSubmission[]> {
    return prisma.formSubmission.findMany({
      where: { submittedById },
      orderBy: { createdAt: "desc" },
    });
  }

  async createFormSubmission(submission: InsertFormSubmission): Promise<FormSubmission> {
    return prisma.formSubmission.create({
      data: { ...submission, data: submission.data as object },
    });
  }
}

export const storage = new DatabaseStorage();
