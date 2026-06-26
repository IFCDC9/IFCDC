import React from "react";
import { formatChartCurrency } from "../../utils/safeFormat";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface FinanceChartProps {
  data: { month: string; donations: number; expenses: number }[];
}

export const FinanceChart: React.FC<FinanceChartProps> = ({ data }) => (
  <div className="hq-chart" style={{ width: "100%", height: 260 }}>
    <ResponsiveContainer>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
        <XAxis dataKey="month" axisLine={false} tickLine={false} />
        <YAxis axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
        <Tooltip
          contentStyle={{ background: "#161616", border: "1px solid rgba(245,200,66,0.25)", borderRadius: 8, color: "#f5f5f5" }}
          formatter={(value: number) => [formatChartCurrency(value), ""]}
        />
        <Legend />
        <Bar dataKey="donations" name="Donations" fill="#f5c842" radius={[4, 4, 0, 0]} />
        <Bar dataKey="expenses" name="Expenses" fill="#6b7280" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  </div>
);
