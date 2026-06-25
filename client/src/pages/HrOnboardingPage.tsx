import React, { useEffect, useState } from "react";
import { peopleApi } from "../api/peopleApi";

type Employee = {
  id?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role: string;
  location?: string;
  startDate?: string;
  status?: string;
  notes?: string;
};

/** @deprecated Use People Management Center at /hq/people — migrated to Phase 3 People API */
const HrOnboardingPage: React.FC = () => {
  const [form, setForm] = useState<Employee>({
    firstName: "", lastName: "", email: "", phone: "", role: "barber",
    location: "", startDate: "", status: "active", notes: "",
  });
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchEmployees = async () => {
    try {
      const data = await peopleApi.list({ type: "employee" });
      setEmployees((data.people ?? []).map((p) => ({
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        email: p.email ?? "",
        phone: p.phone ?? undefined,
        role: p.organizationRole ?? "employee",
        location: p.location ?? undefined,
        startDate: p.startDate ?? undefined,
        status: p.status,
      })));
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchEmployees(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await peopleApi.create({
        person_type: "employee",
        first_name: form.firstName,
        last_name: form.lastName,
        email: form.email,
        phone: form.phone,
        organization_role: form.role,
        location: form.location,
        start_date: form.startDate,
        status: form.status ?? "active",
        notes: form.notes,
      });
      setForm({ firstName: "", lastName: "", email: "", phone: "", role: "barber", location: "", startDate: "", status: "active", notes: "" });
      fetchEmployees();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-page">
      <h2>HR Onboarding (Legacy — redirects to HQ People)</h2>
      <p className="hq-muted-text">This page now uses Phase 3 People APIs. Prefer <a href="/hq/people">People & HR Command Center</a>.</p>
      <form onSubmit={handleSubmit} className="hq-form-grid" style={{ maxWidth: 480, marginBottom: "2rem" }}>
        <input name="firstName" placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
        <input name="lastName" placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
        <input name="email" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <select name="role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="barber">Barber</option>
          <option value="employee">Employee</option>
          <option value="program_staff">Program Staff</option>
        </select>
        <button type="submit" disabled={loading}>{loading ? "Saving…" : "Add Employee"}</button>
      </form>
      <ul>
        {employees.map((e) => <li key={e.id}>{e.firstName} {e.lastName} — {e.role} ({e.status})</li>)}
      </ul>
    </div>
  );
};

export default HrOnboardingPage;
