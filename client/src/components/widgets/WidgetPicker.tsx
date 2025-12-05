import React from "react";

interface WidgetOption {
  type: string;
  title: string;
  description: string;
}

const WIDGET_OPTIONS: WidgetOption[] = [
  {
    type: "client_stats",
    title: "Client Statistics",
    description: "View total clients and active programs",
  },
  {
    type: "recent_encounters",
    title: "Recent Encounters",
    description: "See the latest client encounters",
  },
  {
    type: "upcoming_appointments",
    title: "Upcoming Appointments",
    description: "View upcoming scheduled appointments",
  },
  {
    type: "audit_log_summary",
    title: "Recent Activity",
    description: "Monitor system activity (EXEC only)",
  },
  {
    type: "program_enrollment",
    title: "Program Enrollment",
    description: "See client counts by program",
  },
];

interface Props {
  existingTypes: string[];
  onAdd: (type: string) => void;
  onClose: () => void;
}

export default function WidgetPicker({ existingTypes, onAdd, onClose }: Props) {
  const availableWidgets = WIDGET_OPTIONS.filter(
    (w) => !existingTypes.includes(w.type)
  );

  return (
    <div className="widget-picker-overlay" onClick={onClose} data-testid="widget-picker-overlay">
      <div className="widget-picker-modal" onClick={(e) => e.stopPropagation()} data-testid="widget-picker-modal">
        <div className="widget-picker-header">
          <h3>Add Widget</h3>
          <button className="widget-picker-close" onClick={onClose} data-testid="btn-close-picker">×</button>
        </div>
        <div className="widget-picker-body">
          {availableWidgets.length > 0 ? (
            <div className="widget-picker-grid">
              {availableWidgets.map((widget) => (
                <button
                  key={widget.type}
                  className="widget-picker-option"
                  onClick={() => onAdd(widget.type)}
                  data-testid={`btn-add-${widget.type}`}
                >
                  <div className="widget-picker-option-title">{widget.title}</div>
                  <div className="widget-picker-option-desc">{widget.description}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="widget-picker-empty">
              All widgets have been added to your dashboard.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
