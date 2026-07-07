import React from "react";

export const GrantSubNav: React.FC<{
  items: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}> = ({ items, active, onChange }) => (
  <nav className="hq-sub-nav" aria-label="Section navigation">
    {items.map((item) => (
      <button
        key={item.id}
        type="button"
        className={`hq-btn hq-btn-sm ${active === item.id ? "hq-btn-primary" : "hq-btn-secondary"}`}
        onClick={() => onChange(item.id)}
      >
        {item.label}
      </button>
    ))}
  </nav>
);
