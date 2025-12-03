import { type Chapter, type Form, type InsertChapter, type UpdateChapter, type InsertForm, type UpdateForm } from "@shared/schema";

const API_BASE = "/api";

// Auth API
export const authApi = {
  login: async (username: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message || "Login failed");
    }
    return res.json();
  },
  
  register: async (username: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message || "Registration failed");
    }
    return res.json();
  },
};

// Chapter API
export const chapterApi = {
  getAll: async (): Promise<(Chapter & { formCount: number })[]> => {
    const res = await fetch(`${API_BASE}/chapters`);
    if (!res.ok) throw new Error("Failed to fetch chapters");
    return res.json();
  },
  
  getOne: async (id: string): Promise<Chapter & { formCount: number }> => {
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
  
  update: async (id: string, data: UpdateChapter): Promise<Chapter> => {
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
  
  delete: async (id: string): Promise<void> => {
    const res = await fetch(`${API_BASE}/chapters/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Failed to delete chapter");
  },
};

// Form API
export const formApi = {
  getAll: async (): Promise<Form[]> => {
    const res = await fetch(`${API_BASE}/forms`);
    if (!res.ok) throw new Error("Failed to fetch forms");
    return res.json();
  },
  
  getOne: async (id: string): Promise<Form> => {
    const res = await fetch(`${API_BASE}/forms/${id}`);
    if (!res.ok) throw new Error("Failed to fetch form");
    return res.json();
  },
  
  create: async (data: InsertForm): Promise<Form> => {
    const res = await fetch(`${API_BASE}/forms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message || "Failed to create form");
    }
    return res.json();
  },
  
  update: async (id: string, data: UpdateForm): Promise<Form> => {
    const res = await fetch(`${API_BASE}/forms/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message || "Failed to update form");
    }
    return res.json();
  },
  
  delete: async (id: string): Promise<void> => {
    const res = await fetch(`${API_BASE}/forms/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Failed to delete form");
  },
  
  submit: async (id: string): Promise<Form> => {
    const res = await fetch(`${API_BASE}/forms/${id}/submit`, {
      method: "POST",
    });
    if (!res.ok) throw new Error("Failed to submit form");
    return res.json();
  },
};
