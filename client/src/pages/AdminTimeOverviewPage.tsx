import React, { useEffect, useMemo, useState } from "react";

type Employee = {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  payRate?: number | null;
  payCurrency?: string | null;
};

type Program = {
  id: string;
  name: string;
};

type TimeEntry = {
  id: string;
  date: string;
  hours: number;
  notes?: string | null;
  createdAt: string;
  employee: Employee;
  program?: Program | null;
};

type EmployeeSummary = {
  employeeId: string;
  name: string;
  role: string;
  totalHours: number;
  payRate?: number | null;
  currency?: string | null;
  totalCost: number;
};

const AdminTimeOverviewPage: React.FC = () => {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterProgramId, setFilterProgramId] = useState("");
  const [programs, setPrograms] = useState<Program[]>([]);

  const token = localStorage.getItem("ifcdc_token");

  const fetchTimeEntries = async () => {
    setLoading(true);
    const res = await fetch("/api/time-entries", {
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
      },
    });
    setLoading(false);

    if (res.ok) {
      const data = await res.json();
      setEntries(data);
    } else {
      alert("Error loading time entries for admin.");
    }
  };

  const fetchPrograms = async () => {
    const res = await fetch("/api/programs", {
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
      },
    });
    if (res.ok) {
      const data = await res.json();
      setPrograms(data);
    }
  };

  useEffect(() => {
    fetchTimeEntries();
    fetchPrograms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredEntries = useMemo(() => {
    let data = [...entries];

    if (filterFrom) {
      const fromTs = new Date(filterFrom).getTime();
      data = data.filter(e => new Date(e.date).getTime() >= fromTs);
    }

    if (filterTo) {
      const toTs = new Date(filterTo).getTime();
      data = data.filter(e => new Date(e.date).getTime() <= toTs);
    }

    if (filterProgramId) {
      data = data.filter(e => e.program?.id === filterProgramId);
    }

    data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return data;
  }, [entries, filterFrom, filterTo, filterProgramId]);

  const employeeSummaries: EmployeeSummary[] = useMemo(() => {
    const map = new Map<string, EmployeeSummary>();

    for (const e of filteredEntries) {
      const emp = e.employee;
      const id = emp.id;

      if (!map.has(id)) {
        map.set(id, {
          employeeId: id,
          name: `${emp.firstName} ${emp.lastName}`,
          role: emp.role,
          totalHours: 0,
          payRate: emp.payRate ?? null,
          currency: emp.payCurrency ?? "USD",
          totalCost: 0,
        });
      }

      const current = map.get(id)!;
      current.totalHours += e.hours;

      if (typeof emp.payRate === "number") {
        current.totalCost += e.hours * emp.payRate;
      }
    }

    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [filteredEntries]);

  const programSummaries = useMemo(() => {
    const map = new Map<
      string,
      { programId: string; name: string; totalHours: number; totalCost: number; currency: string }
    >();

    for (const e of filteredEntries) {
      if (!e.program) continue;
      const emp = e.employee;
      const payRate = emp.payRate ?? null;
      const programId = e.program.id;

      if (!map.has(programId)) {
        map.set(programId, {
          programId,
          name: e.program.name,
          totalHours: 0,
          totalCost: 0,
          currency: emp.payCurrency ?? "USD",
        });
      }

      const current = map.get(programId)!;
      current.totalHours += e.hours;

      if (typeof payRate === "number") {
        current.totalCost += e.hours * payRate;
      }
    }

    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [filteredEntries]);

  const buildExportUrl = () => {
    const params = new URLSearchParams();
    if (filterFrom) params.append("from", filterFrom);
    if (filterTo) params.append("to", filterTo);
    if (filterProgramId) params.append("programId", filterProgramId);
    return `/api/time-entries/export?${params.toString()}`;
  };

  const handleDownloadCsv = () => {
    const url = buildExportUrl();
    window.location.href = url;
  };

  return (
    <div style={{ padding: "1.5rem" }}>
      <h1>Admin – Time Overview (Payroll & Programs)</h1>

      <section
        style={{
          marginTop: "1rem",
          marginBottom: "1.5rem",
          display: "grid",
          gap: "0.75rem",
          maxWidth: 640,
        }}
      >
        <h2>Filters</h2>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <div>
            <label>From</label>
            <br />
            <input
              type="date"
              value={filterFrom}
              onChange={e => setFilterFrom(e.target.value)}
            />
          </div>
          <div>
            <label>To</label>
            <br />
            <input
              type="date"
              value={filterTo}
              onChange={e => setFilterTo(e.target.value)}
            />
          </div>
          <div>
            <label>Program</label>
            <br />
            <select
              value={filterProgramId}
              onChange={e => setFilterProgramId(e.target.value)}
            >
              <option value="">All Programs</option>
              {programs.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginTop: "0.75rem" }}>
          <button type="button" onClick={handleDownloadCsv}>
            Download CSV for Accountant / Agency
          </button>
        </div>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>Payroll Summary – Hours & Cost by Employee</h2>
        {employeeSummaries.length === 0 ? (
          <p>No time entries match the current filters.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Employee</th>
                <th align="left">Role</th>
                <th align="left">Total Hours</th>
                <th align="left">Pay Rate</th>
                <th align="left">Total Cost</th>
              </tr>
            </thead>
            <tbody>
              {employeeSummaries.map(s => (
                <tr key={s.employeeId}>
                  <td>{s.name}</td>
                  <td>{s.role}</td>
                  <td>{s.totalHours.toFixed(2)}</td>
                  <td>
                    {typeof s.payRate === "number"
                      ? `$${s.payRate.toFixed(2)} ${s.currency ?? "USD"}/hr`
                      : "N/A"}
                  </td>
                  <td>
                    {typeof s.payRate === "number"
                      ? `$${s.totalCost.toFixed(2)} ${s.currency ?? "USD"}`
                      : "N/A"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>Program Summary – Hours & Cost by Program</h2>
        {programSummaries.length === 0 ? (
          <p>No program-linked hours in this window.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Program</th>
                <th align="left">Total Hours</th>
                <th align="left">Total Cost</th>
              </tr>
            </thead>
            <tbody>
              {programSummaries.map(p => (
                <tr key={p.programId}>
                  <td>{p.name}</td>
                  <td>{p.totalHours.toFixed(2)}</td>
                  <td>
                    ${p.totalCost.toFixed(2)} {p.currency}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Detail – Individual Time Entries</h2>
        {loading ? (
          <p>Loading…</p>
        ) : filteredEntries.length === 0 ? (
          <p>No entries to display.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }} data-testid="table-time-entries">
            <thead>
              <tr>
                <th align="left">Date</th>
                <th align="left">Employee</th>
                <th align="left">Role</th>
                <th align="left">Hours</th>
                <th align="left">Program</th>
                <th align="left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map(e => (
                <tr key={e.id} data-testid={`row-entry-${e.id}`}>
                  <td>{new Date(e.date).toLocaleString()}</td>
                  <td>
                    {e.employee.firstName} {e.employee.lastName}
                  </td>
                  <td>{e.employee.role}</td>
                  <td>{e.hours}</td>
                  <td>{e.program?.name || "-"}</td>
                  <td>{e.notes || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};

export default AdminTimeOverviewPage;
