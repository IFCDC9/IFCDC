import React, { useEffect, useState } from "react";
import { getWidgetData } from "../../api/dashboardApi";

interface Appointment {
  id: string;
  client_name: string;
  program: string;
  start_time: string;
  location: string | null;
}

interface Props {
  onRemove: () => void;
}

export default function UpcomingAppointmentsWidget({ onRemove }: Props) {
  const [data, setData] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getWidgetData("upcoming_appointments")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const formatDateTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <div className="widget-content" data-testid="widget-upcoming-appointments">
      <div className="widget-header">
        <span className="widget-title">Upcoming Appointments</span>
        <button className="widget-remove-btn" onClick={onRemove} data-testid="btn-remove-widget">×</button>
      </div>
      {loading ? (
        <div className="widget-loading">Loading...</div>
      ) : data.length > 0 ? (
        <div className="widget-list">
          {data.slice(0, 5).map((appt) => (
            <div key={appt.id} className="widget-list-item" data-testid={`appointment-${appt.id}`}>
              <div className="widget-list-primary">{appt.client_name}</div>
              <div className="widget-list-secondary">
                {formatDateTime(appt.start_time)}
                {appt.location && ` • ${appt.location}`}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="widget-empty">No upcoming appointments</div>
      )}
    </div>
  );
}
