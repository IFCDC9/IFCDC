import { 
  type User, 
  type InsertUser,
  type Chapter,
  type InsertChapter,
  type UpdateChapter,
  type Form,
  type InsertForm,
  type UpdateForm,
  users,
  chapters,
  forms
} from "@shared/schema";
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { eq, desc, sql } from "drizzle-orm";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool });

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Chapter methods
  getAllChapters(): Promise<Chapter[]>;
  getChapter(id: string): Promise<Chapter | undefined>;
  createChapter(chapter: InsertChapter): Promise<Chapter>;
  updateChapter(id: string, chapter: UpdateChapter): Promise<Chapter | undefined>;
  deleteChapter(id: string): Promise<boolean>;
  
  // Form methods
  getAllForms(): Promise<Form[]>;
  getFormsByChapter(chapterId: string): Promise<Form[]>;
  getForm(id: string): Promise<Form | undefined>;
  createForm(form: InsertForm): Promise<Form>;
  updateForm(id: string, form: UpdateForm): Promise<Form | undefined>;
  deleteForm(id: string): Promise<boolean>;
  incrementFormSubmissions(id: string): Promise<Form | undefined>;
}

export class DatabaseStorage implements IStorage {
  // User methods
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  // Chapter methods
  async getAllChapters(): Promise<Chapter[]> {
    return db.select().from(chapters).orderBy(desc(chapters.updatedAt));
  }

  async getChapter(id: string): Promise<Chapter | undefined> {
    const [chapter] = await db.select().from(chapters).where(eq(chapters.id, id));
    return chapter;
  }

  async createChapter(chapter: InsertChapter): Promise<Chapter> {
    const [newChapter] = await db.insert(chapters).values(chapter).returning();
    return newChapter;
  }

  async updateChapter(id: string, chapter: UpdateChapter): Promise<Chapter | undefined> {
    const [updated] = await db
      .update(chapters)
      .set({ ...chapter, updatedAt: new Date() })
      .where(eq(chapters.id, id))
      .returning();
    return updated;
  }

  async deleteChapter(id: string): Promise<boolean> {
    const result = await db.delete(chapters).where(eq(chapters.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  // Form methods
  async getAllForms(): Promise<Form[]> {
    return db.select().from(forms).orderBy(desc(forms.createdAt));
  }

  async getFormsByChapter(chapterId: string): Promise<Form[]> {
    return db.select().from(forms).where(eq(forms.chapterId, chapterId));
  }

  async getForm(id: string): Promise<Form | undefined> {
    const [form] = await db.select().from(forms).where(eq(forms.id, id));
    return form;
  }

  async createForm(form: InsertForm): Promise<Form> {
    const [newForm] = await db.insert(forms).values(form).returning();
    return newForm;
  }

  async updateForm(id: string, form: UpdateForm): Promise<Form | undefined> {
    const [updated] = await db
      .update(forms)
      .set({ ...form, updatedAt: new Date() })
      .where(eq(forms.id, id))
      .returning();
    return updated;
  }

  async deleteForm(id: string): Promise<boolean> {
    const result = await db.delete(forms).where(eq(forms.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async incrementFormSubmissions(id: string): Promise<Form | undefined> {
    const [updated] = await db
      .update(forms)
      .set({ 
        submissions: sql`${forms.submissions} + 1`,
        updatedAt: new Date()
      })
      .where(eq(forms.id, id))
      .returning();
    return updated;
  }
}

export const storage = new DatabaseStorage();
