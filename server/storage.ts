import { 
  type User, 
  type SafeUser,
  type InsertUser,
  type Chapter,
  type InsertChapter,
  type UpdateChapter,
  type PolicyAcknowledgement,
  type InsertAcknowledgement,
  users,
  chapters,
  policyAcknowledgements
} from "@shared/schema";
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { eq, desc, and, sql } from "drizzle-orm";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool });

export interface IStorage {
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserLastLogin(id: number): Promise<void>;
  getAllUsers(): Promise<SafeUser[]>;
  
  // Chapter methods
  getAllChapters(): Promise<Chapter[]>;
  getActiveChapters(): Promise<Chapter[]>;
  getChapter(id: number): Promise<Chapter | undefined>;
  getChapterBySlug(slug: string): Promise<Chapter | undefined>;
  createChapter(chapter: InsertChapter): Promise<Chapter>;
  updateChapter(id: number, chapter: UpdateChapter): Promise<Chapter | undefined>;
  deleteChapter(id: number): Promise<boolean>;
  
  // Acknowledgement methods
  getAcknowledgement(userId: number, chapterId: number): Promise<PolicyAcknowledgement | undefined>;
  getUserAcknowledgements(userId: number): Promise<PolicyAcknowledgement[]>;
  getChapterAcknowledgements(chapterId: number): Promise<PolicyAcknowledgement[]>;
  createAcknowledgement(ack: InsertAcknowledgement): Promise<PolicyAcknowledgement>;
  getAcknowledgementStats(): Promise<{ chapterId: number; count: number }[]>;
}

export class DatabaseStorage implements IStorage {
  // User methods
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUserLastLogin(id: number): Promise<void> {
    await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, id));
  }

  async getAllUsers(): Promise<SafeUser[]> {
    const allUsers = await db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
      lastLogin: users.lastLogin,
    }).from(users).orderBy(desc(users.createdAt));
    return allUsers as SafeUser[];
  }

  // Chapter methods
  async getAllChapters(): Promise<Chapter[]> {
    return db.select().from(chapters).orderBy(chapters.number);
  }

  async getActiveChapters(): Promise<Chapter[]> {
    return db.select().from(chapters).where(eq(chapters.isActive, true)).orderBy(chapters.number);
  }

  async getChapter(id: number): Promise<Chapter | undefined> {
    const [chapter] = await db.select().from(chapters).where(eq(chapters.id, id));
    return chapter;
  }

  async getChapterBySlug(slug: string): Promise<Chapter | undefined> {
    const [chapter] = await db.select().from(chapters).where(eq(chapters.slug, slug));
    return chapter;
  }

  async createChapter(chapter: InsertChapter): Promise<Chapter> {
    const [newChapter] = await db.insert(chapters).values(chapter).returning();
    return newChapter;
  }

  async updateChapter(id: number, chapter: UpdateChapter): Promise<Chapter | undefined> {
    const [updated] = await db
      .update(chapters)
      .set({ ...chapter, updatedAt: new Date() })
      .where(eq(chapters.id, id))
      .returning();
    return updated;
  }

  async deleteChapter(id: number): Promise<boolean> {
    const result = await db.delete(chapters).where(eq(chapters.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  // Acknowledgement methods
  async getAcknowledgement(userId: number, chapterId: number): Promise<PolicyAcknowledgement | undefined> {
    const [ack] = await db.select().from(policyAcknowledgements)
      .where(and(
        eq(policyAcknowledgements.userId, userId),
        eq(policyAcknowledgements.chapterId, chapterId)
      ))
      .orderBy(desc(policyAcknowledgements.acknowledgedAt))
      .limit(1);
    return ack;
  }

  async getUserAcknowledgements(userId: number): Promise<PolicyAcknowledgement[]> {
    return db.select().from(policyAcknowledgements)
      .where(eq(policyAcknowledgements.userId, userId))
      .orderBy(desc(policyAcknowledgements.acknowledgedAt));
  }

  async getChapterAcknowledgements(chapterId: number): Promise<PolicyAcknowledgement[]> {
    return db.select().from(policyAcknowledgements)
      .where(eq(policyAcknowledgements.chapterId, chapterId))
      .orderBy(desc(policyAcknowledgements.acknowledgedAt));
  }

  async createAcknowledgement(ack: InsertAcknowledgement): Promise<PolicyAcknowledgement> {
    const [newAck] = await db.insert(policyAcknowledgements).values(ack).returning();
    return newAck;
  }

  async getAcknowledgementStats(): Promise<{ chapterId: number; count: number }[]> {
    const stats = await db
      .select({
        chapterId: policyAcknowledgements.chapterId,
        count: sql<number>`count(distinct ${policyAcknowledgements.userId})::int`,
      })
      .from(policyAcknowledgements)
      .groupBy(policyAcknowledgements.chapterId);
    return stats;
  }
}

export const storage = new DatabaseStorage();
