import React from 'react';

export default function StatsCards({ overview }) {
  if (!overview) return null;

  const cards = [
    {
      label: 'Total Incidents',
      value: overview.incidents.total,
      sublabel: 'All reported incidents',
      tone: 'primary',
    },
    {
      label: 'High-Risk Incidents',
      value: overview.incidents.highRisk,
      sublabel: 'Weapons, serious injury, self-harm, etc.',
      tone: 'danger',
    },
    {
      label: 'Open Incidents',
      value: overview.incidents.open,
      sublabel: 'Requires follow-up or review',
      tone: 'warning',
    },
    {
      label: 'Total Intakes',
      value: overview.intakes.total,
      sublabel: 'Participants onboarded',
      tone: 'secondary',
    },
  ];

  return (
    <div className="stats-grid">
      {cards.map((card) => (
        <div key={card.label} className={`stat-card stat-${card.tone}`}>
          <div className="stat-label">{card.label}</div>
          <div className="stat-value">{card.value ?? 0}</div>
          <div className="stat-sublabel">{card.sublabel}</div>
        </div>
      ))}
    </div>
  );
}
