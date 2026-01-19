import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

interface FundingEvent {
  source_key: string;
  intent: string;
  amount_cents: number;
}

const COLORS = ["#d4af37", "#4ade80", "#60a5fa", "#f472b6", "#fbbf24"];

export default function FundingCharts() {
  const [events, setEvents] = useState<FundingEvent[]>([]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    fetch("/api/admin/funding-events", {
      headers: { "Authorization": `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(setEvents);
  }, []);

  const bySource = events.reduce((acc, e) => {
    acc[e.source_key] = (acc[e.source_key] || 0) + e.amount_cents / 100;
    return acc;
  }, {} as Record<string, number>);

  const byIntent = events.reduce((acc, e) => {
    acc[e.intent] = (acc[e.intent] || 0) + e.amount_cents / 100;
    return acc;
  }, {} as Record<string, number>);

  const sourceData = Object.entries(bySource).map(([name, value]) => ({ name: name.toUpperCase(), value }));
  const intentData = Object.entries(byIntent).map(([name, value]) => ({ name, value }));

  if (events.length === 0) {
    return (
      <div className="bg-[#111] rounded-lg p-6">
        <h3 className="text-[#d4af37] text-lg font-semibold mb-4">Funding Charts</h3>
        <p className="text-gray-500">No data to display yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-[#111] rounded-lg p-6">
      <h3 className="text-[#d4af37] text-lg font-semibold mb-4">Funding Charts</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h4 className="text-gray-400 text-sm mb-2">By Source</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={sourceData}>
              <XAxis dataKey="name" stroke="#888" fontSize={12} />
              <YAxis stroke="#888" fontSize={12} />
              <Tooltip 
                contentStyle={{ background: "#1a1a1a", border: "1px solid #333" }}
                formatter={(value: number) => [`$${value.toFixed(2)}`, "Amount"]}
              />
              <Bar dataKey="value" fill="#d4af37" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <h4 className="text-gray-400 text-sm mb-2">By Intent</h4>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={intentData}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={80}
                dataKey="value"
                label={({ name, value }) => `${name}: $${value.toFixed(0)}`}
              >
                {intentData.map((_, i) => (
                  <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ background: "#1a1a1a", border: "1px solid #333" }}
                formatter={(value: number) => [`$${value.toFixed(2)}`, "Amount"]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
