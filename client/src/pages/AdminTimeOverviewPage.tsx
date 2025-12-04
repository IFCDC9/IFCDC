import React, { useEffect, useMemo, useState } from "react";

type Employee = {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  payRate?: number | null;
  payCurrency?: string | null;
};

type FundingSource = {
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
  fundingSource?: FundingSource | null;
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

type FundingSourceSummary = {
  fundingSourceId: string;
  name: string;
  totalHours: number;
  totalCost: number;
  currency: string;
};

const AdminTimeOverviewPage: React.FC = () => {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterFundingSourceId, setFilterFundingSourceId] = useState("");
  const [fundingSources, setFundingSources] = useState<FundingSource[]>([]);

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
    fetchTimeEntries();
    fetchFundingSources();
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

    if (filterFundingSourceId) {
      data = data.filter(e => e.fundingSource?.id === filterFundingSourceId);
    }

    data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return data;
  }, [entries, filterFrom, filterTo, filterFundingSourceId]);

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

  const fundingSourceSummaries: FundingSourceSummary[] = useMemo(() => {
    const map = new Map<string, FundingSourceSummary>();

    for (const e of filteredEntries) {
      if (!e.fundingSource) continue;
      const emp = e.employee;
      const payRate = emp.payRate ?? null;
      const fundingSourceId = e.fundingSource.id;

      if (!map.has(fundingSourceId)) {
        map.set(fundingSourceId, {
          fundingSourceId,
          name: e.fundingSource.name,
          totalHours: 0,
          totalCost: 0,
          currency: emp.payCurrency ?? "USD",
        });
      }

      const current = map.get(fundingSourceId)!;
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
    if (filterFundingSourceId) params.append("fundingSourceId", filterFundingSourceId);
    return `/api/time-entries/export?${params.toString()}`;
  };

  const handleDownloadCsv = () => {
    const url = buildExportUrl();
    window.location.href = url;
  };

  return (
    <div style={{ padding: "1.5rem" }}>
      <h1>Admin – Time Overview (Payroll & Funding Sources)</h1>

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
            <label>Funding Source</label>
            <br />
            <select
              value={filterFundingSourceId}
              onChange={e => setFilterFundingSourceId(e.target.value)}
            >
              <option value="">All Funding Sources</option>
              {fundingSources.map(fs => (
                <option key={fs.id} value={fs.id}>
                  {fs.name}
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
        <h2>Funding Source Summary – Hours & Cost by Grant</h2>
        {fundingSourceSummaries.length === 0 ? (
          <p>No funding-source-linked hours in this window.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Funding Source</th>
                <th align="left">Total Hours</th>
                <th align="left">Total Cost</th>
              </tr>
            </thead>
            <tbody>
              {fundingSourceSummaries.map(fs => (
                <tr key={fs.fundingSourceId}>
                  <td>{fs.name}</td>
                  <td>{fs.totalHours.toFixed(2)}</td>
                  <td>
                    ${fs.totalCost.toFixed(2)} {fs.currency}
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
                <th align="left">Funding Source</th>
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
                  <td>{e.fundingSource?.name || "-"}</td>
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
