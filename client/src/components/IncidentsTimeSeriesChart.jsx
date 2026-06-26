import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

export default function IncidentsTimeSeriesChart({ data }) {
  const points = data?.points || [];

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Incidents Over Time</h3>
        <span className="panel-subtitle">Trendline for the last 30 days</span>
      </div>
      <div className="panel-body chart-body">
        {points.length === 0 ? (
          <div className="empty-state">No incident activity in the selected window.</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={points} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="count" dot />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
