import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

export default function IncidentsByProgramChart({ data }) {
  const cleaned = (data?.series || []).map((item) => ({
    program: formatProgramLabel(item.program),
    count: item.count,
  }));

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Incidents by Program</h3>
        <span className="panel-subtitle">Distribution across IFCDC portfolios</span>
      </div>
      <div className="panel-body chart-body">
        {cleaned.length === 0 ? (
          <div className="empty-state">No incident data available yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={cleaned} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="program" angle={-25} textAnchor="end" height={60} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function formatProgramLabel(program) {
  switch (program) {
    case 'youth_development': return 'Youth Dev';
    case 'cvi': return 'CVI';
    case 'workforce': return 'Workforce';
    case 'barbershop': return 'Barbershop';
    case 'family_services': return 'Family Svcs';
    case 'radio_media': return 'Radio/Media';
    case 'other': return 'Other';
    default: return program || 'Unknown';
  }
}
