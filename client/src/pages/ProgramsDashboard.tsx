import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

type FundingSource = {
  id: string;
  name: string;
  code?: string | null;
};

type Program = {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  location?: string | null;
  status: string;
  fundingSourceId?: string | null;
  fundingSource?: FundingSource | null;
};

const ProgramsDashboard: React.FC = () => {
  const { user } = useAuth();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [fundingSources, setFundingSources] = useState<FundingSource[]>([]);
  const [loading, setLoading] = useState(true);

  const [newProgram, setNewProgram] = useState({
    name: "",
    code: "",
    description: "",
    location: "",
  });

  const token = localStorage.getItem("ifcdc_token");

  const fetchPrograms = async () => {
    setLoading(true);
    const res = await fetch("/api/programs", {
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
      },
    });
    setLoading(false);
    if (res.ok) {
      const data = await res.json();
      setPrograms(data);
    } else {
      alert("Error loading programs");
    }
  };

  const fetchFundingSources = async () => {
    const res = await fetch("/api/funding-sources", {
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
      },
    });
    if (res.ok) {
      const data = await res.json();
      setFundingSources(data);
    }
  };

  useEffect(() => {
    fetchPrograms();
    fetchFundingSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setNewProgram(prev => ({ ...prev, [name]: value }));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProgram.name) return;

    const res = await fetch("/api/programs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : "",
      },
      body: JSON.stringify(newProgram),
    });

    if (res.ok) {
      setNewProgram({ name: "", code: "", description: "", location: "" });
      fetchPrograms();
    } else {
      alert("Error creating program");
    }
  };

  const handleAssignFundingSource = async (programId: string, fundingSourceId: string | "") => {
    const res = await fetch(`/api/programs/${programId}/funding-source`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : "",
      },
      body: JSON.stringify({ fundingSourceId: fundingSourceId || null }),
    });

    if (res.ok) {
      fetchPrograms();
    } else {
      const body = await res.json().catch(() => null);
      alert(body?.error || "Error updating funding source for program.");
    }
  };

  const isAdmin = user?.role === "admin";

  return (
    <div style={{ padding: "1.5rem" }}>
      <h1>IFCDC Programs</h1>
      <p>Role: {user?.role}</p>

      {isAdmin && (
        <section style={{ marginTop: "1rem", marginBottom: "2rem" }}>
          <h2>Create New Program</h2>
          <form onSubmit={handleCreate} style={{ maxWidth: 480, display: "grid", gap: "0.75rem" }}>
            <input
              name="name"
              placeholder="Program Name (e.g. Anti-Gang Initiative)"
              value={newProgram.name}
              onChange={handleChange}
              required
              data-testid="input-program-name"
            />
            <input
              name="code"
              placeholder="Short Code (optional, e.g. ANTI_GANG)"
              value={newProgram.code}
              onChange={handleChange}
              data-testid="input-program-code"
            />
            <input
              name="location"
              placeholder="Location (e.g. Asbury Park, NJ)"
              value={newProgram.location}
              onChange={handleChange}
              data-testid="input-program-location"
            />
            <textarea
              name="description"
              placeholder="Program Description"
              value={newProgram.description}
              onChange={handleChange}
              rows={3}
              data-testid="input-program-description"
            />
            <button type="submit" data-testid="button-create-program">Create Program</button>
          </form>
        </section>
      )}

      <section>
        <h2>Active Programs</h2>
        {loading ? (
          <p>Loading...</p>
        ) : programs.length === 0 ? (
          <p>No programs yet.</p>
        ) : (
          <ul>
            {programs.map(p => (
              <li key={p.id} style={{ marginBottom: "0.75rem" }} data-testid={`program-item-${p.id}`}>
                <strong>{p.name}</strong>{" "}
                {p.code && <span>({p.code})</span>}
                {p.location && <div>Location: {p.location}</div>}
                {p.description && <div>{p.description}</div>}
                <div>Status: {p.status}</div>
                {isAdmin && (
                  <div style={{ marginTop: "0.5rem" }}>
                    <label>Funding Source: </label>
                    <select
                      value={p.fundingSourceId || ""}
                      onChange={e => handleAssignFundingSource(p.id, e.target.value)}
                      data-testid={`select-funding-${p.id}`}
                    >
                      <option value="">-- None --</option>
                      {fundingSources.map(fs => (
                        <option key={fs.id} value={fs.id}>
                          {fs.name} {fs.code ? `(${fs.code})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <Link to={`/programs/${p.id}`} data-testid={`link-program-${p.id}`}>View Details</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default ProgramsDashboard;
