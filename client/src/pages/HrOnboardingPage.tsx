import React, { useEffect, useState } from "react";

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

const HrOnboardingPage: React.FC = () => {
  const [form, setForm] = useState<Employee>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    role: "barber",
    location: "",
    startDate: "",
    status: "onboarding",
    notes: "",
  });

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const fetchEmployees = async () => {
    const res = await fetch("/api/hr/employees");
    if (res.ok) {
      const data = await res.json();
      setEmployees(data);
    }
  };

  useEffect(() => {
    fetchEmployees();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/hr/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    setLoading(false);

    if (res.ok) {
      setForm(prev => ({
        ...prev,
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        location: "",
        startDate: "",
        notes: "",
        status: "onboarding",
      }));
      fetchEmployees();
      alert("Employee onboarded successfully.");
    } else {
      alert("Error onboarding employee.");
    }
  };

  return (
    <div className="hr-onboarding-page">
      <header className="page-header">
        <h1>IFCDC HR – Staff Onboarding</h1>
      </header>

      <div className="hr-content">
        <div className="onboarding-form-card">
          <h2>Add New Employee</h2>
          <form onSubmit={handleSubmit} className="onboarding-form">
            <div className="form-row">
              <div className="form-field">
                <label>First Name</label>
                <input name="firstName" value={form.firstName} onChange={handleChange} required data-testid="input-firstName" />
              </div>
              <div className="form-field">
                <label>Last Name</label>
                <input name="lastName" value={form.lastName} onChange={handleChange} required data-testid="input-lastName" />
              </div>
            </div>

            <div className="form-row">
              <div className="form-field">
                <label>Email</label>
                <input type="email" name="email" value={form.email} onChange={handleChange} required data-testid="input-email" />
              </div>
              <div className="form-field">
                <label>Phone</label>
                <input name="phone" value={form.phone} onChange={handleChange} data-testid="input-phone" />
              </div>
            </div>

            <div className="form-row">
              <div className="form-field">
                <label>Role</label>
                <select name="role" value={form.role} onChange={handleChange} data-testid="select-role">
                  <option value="barber">Barber</option>
                  <option value="radio_host">Radio Host</option>
                  <option value="program_staff">Program Staff</option>
                  <option value="admin">Admin</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="form-field">
                <label>Location</label>
                <input name="location" value={form.location} onChange={handleChange} data-testid="input-location" />
              </div>
            </div>

            <div className="form-row">
              <div className="form-field">
                <label>Start Date</label>
                <input type="date" name="startDate" value={form.startDate} onChange={handleChange} data-testid="input-startDate" />
              </div>
              <div className="form-field">
                <label>Status</label>
                <select name="status" value={form.status} onChange={handleChange} data-testid="select-status">
                  <option value="onboarding">Onboarding</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>

            <div className="form-field">
              <label>Notes</label>
              <textarea name="notes" value={form.notes} onChange={handleChange} rows={3} data-testid="textarea-notes" />
            </div>

            <button type="submit" className="btn-primary" disabled={loading} data-testid="button-submit">
              {loading ? "Saving..." : "Add Employee"}
            </button>
          </form>
        </div>

        <div className="employees-list-card">
          <h2>Current Staff</h2>
          {employees.length === 0 ? (
            <div className="empty-state">No employees added yet.</div>
          ) : (
            <table className="employees-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Start Date</th>
                </tr>
              </thead>
              <tbody>
                {employees.map(emp => (
                  <tr key={emp.id || emp.email} data-testid={`employee-row-${emp.id}`}>
                    <td>{emp.firstName} {emp.lastName}</td>
                    <td>{emp.role}</td>
                    <td><span className={`status-badge status-${emp.status}`}>{emp.status}</span></td>
                    <td>{emp.startDate ? new Date(emp.startDate).toLocaleDateString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default HrOnboardingPage;
