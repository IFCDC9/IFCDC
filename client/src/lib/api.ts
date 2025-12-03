import { type Chapter, type InsertChapter, type UpdateChapter, type SafeUser, type PolicyAcknowledgement } from "@shared/schema";

const API_BASE = "/api";

// Auth API
export const authApi = {
  login: async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message || "Login failed");
    }
    return res.json();
  },
  
  register: async (name: string, email: string, password: string, role: string = "staff") => {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, passwordHash: password, role }),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message || "Registration failed");
    }
    return res.json();
  },
};

// User API
export const userApi = {
  getAll: async (): Promise<SafeUser[]> => {
    const res = await fetch(`${API_BASE}/users`);
    if (!res.ok) throw new Error("Failed to fetch users");
    return res.json();
  },
};

// Chapter API
export type ChapterWithCount = Chapter & { acknowledgementCount: number };

export const chapterApi = {
  getAll: async (): Promise<ChapterWithCount[]> => {
    const res = await fetch(`${API_BASE}/chapters`);
    if (!res.ok) throw new Error("Failed to fetch chapters");
    return res.json();
  },
  
  getActive: async (): Promise<Chapter[]> => {
    const res = await fetch(`${API_BASE}/chapters/active`);
    if (!res.ok) throw new Error("Failed to fetch active chapters");
    return res.json();
  },
  
  getOne: async (id: number): Promise<ChapterWithCount> => {
    const res = await fetch(`${API_BASE}/chapters/${id}`);
    if (!res.ok) throw new Error("Failed to fetch chapter");
    return res.json();
  },
  
  create: async (data: InsertChapter): Promise<Chapter> => {
    const res = await fetch(`${API_BASE}/chapters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message || "Failed to create chapter");
    }
    return res.json();
  },
  
  update: async (id: number, data: UpdateChapter): Promise<Chapter> => {
    const res = await fetch(`${API_BASE}/chapters/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message || "Failed to update chapter");
    }
    return res.json();
  },
  
  delete: async (id: number): Promise<void> => {
    const res = await fetch(`${API_BASE}/chapters/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Failed to delete chapter");
  },
};

// Acknowledgement API
export const acknowledgementApi = {
  getStats: async (): Promise<{ chapterId: number; count: number }[]> => {
    const res = await fetch(`${API_BASE}/acknowledgements`);
    if (!res.ok) throw new Error("Failed to fetch acknowledgement stats");
    return res.json();
  },
  
  getByUser: async (userId: number): Promise<PolicyAcknowledgement[]> => {
    const res = await fetch(`${API_BASE}/acknowledgements/user/${userId}`);
    if (!res.ok) throw new Error("Failed to fetch user acknowledgements");
    return res.json();
  },
  
  getByChapter: async (chapterId: number): Promise<PolicyAcknowledgement[]> => {
    const res = await fetch(`${API_BASE}/acknowledgements/chapter/${chapterId}`);
    if (!res.ok) throw new Error("Failed to fetch chapter acknowledgements");
    return res.json();
  },
  
  create: async (userId: number, chapterId: number): Promise<PolicyAcknowledgement> => {
    const res = await fetch(`${API_BASE}/acknowledgements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, chapterId, version: 1 }),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message || "Failed to create acknowledgement");
    }
    return res.json();
  },
};
