import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import type { User, Chapter, PolicyAcknowledgement } from "../generated/prisma/client";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

export type SafeUser = Omit<User, "passwordHash">;

export type InsertUser = {
  name: string;
  email: string;
  passwordHash: string;
  role?: string;
  isActive?: boolean;
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
  userId: number;
  chapterId: number;
  version: number;
};

export interface IStorage {
  getUser(id: number): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  createUser(user: InsertUser): Promise<User>;
  updateUserLastLogin(id: number): Promise<void>;
  getAllUsers(): Promise<SafeUser[]>;
  
  getAllChapters(): Promise<Chapter[]>;
  getActiveChapters(): Promise<Chapter[]>;
  getChapter(id: number): Promise<Chapter | null>;
  getChapterBySlug(slug: string): Promise<Chapter | null>;
  createChapter(chapter: InsertChapter): Promise<Chapter>;
  updateChapter(id: number, chapter: UpdateChapter): Promise<Chapter | null>;
  deleteChapter(id: number): Promise<boolean>;
  
  getAcknowledgement(userId: number, chapterId: number): Promise<PolicyAcknowledgement | null>;
  getUserAcknowledgements(userId: number): Promise<PolicyAcknowledgement[]>;
  getChapterAcknowledgements(chapterId: number): Promise<PolicyAcknowledgement[]>;
  createAcknowledgement(ack: InsertAcknowledgement): Promise<PolicyAcknowledgement>;
  getAcknowledgementStats(): Promise<{ chapterId: number; count: number }[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  }

  async getUserByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    return prisma.user.create({ data: insertUser });
  }

  async updateUserLastLogin(id: number): Promise<void> {
    await prisma.user.update({
      where: { id },
      data: { lastLogin: new Date() },
    });
  }

  async getAllUsers(): Promise<SafeUser[]> {
    const allUsers = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        lastLogin: true,
      },
      orderBy: { id: "desc" },
    });
    return allUsers;
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
      return await prisma.chapter.update({
        where: { id },
        data: chapter,
      });
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

  async getAcknowledgement(userId: number, chapterId: number): Promise<PolicyAcknowledgement | null> {
    return prisma.policyAcknowledgement.findFirst({
      where: { userId, chapterId },
      orderBy: { acknowledgedAt: "desc" },
    });
  }

  async getUserAcknowledgements(userId: number): Promise<PolicyAcknowledgement[]> {
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
}

export const storage = new DatabaseStorage();
