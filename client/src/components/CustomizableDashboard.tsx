import React, { useEffect, useState, useCallback } from "react";
import GridLayout, { Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { useAuth } from "../auth/AuthContext";
import {
  getWidgets,
  addWidget,
  deleteWidget,
  batchUpdateLayouts,
  DashboardWidget,
} from "../api/dashboardApi";

import ClientStatsWidget from "./widgets/ClientStatsWidget";
import RecentEncountersWidget from "./widgets/RecentEncountersWidget";
import UpcomingAppointmentsWidget from "./widgets/UpcomingAppointmentsWidget";
import AuditLogSummaryWidget from "./widgets/AuditLogSummaryWidget";
import ProgramEnrollmentWidget from "./widgets/ProgramEnrollmentWidget";
import StaffingOverviewWidget from "./widgets/StaffingOverviewWidget";
import WidgetPicker from "./widgets/WidgetPicker";

const WIDGET_COMPONENTS: Record<string, React.ComponentType<{ onRemove: () => void }>> = {
  client_stats: ClientStatsWidget,
  recent_encounters: RecentEncountersWidget,
  upcoming_appointments: UpcomingAppointmentsWidget,
  audit_log_summary: AuditLogSummaryWidget,
  program_enrollment: ProgramEnrollmentWidget,
  staffing_overview: StaffingOverviewWidget,
};

export default function CustomizableDashboard() {
  const { user } = useAuth();
  const [widgets, setWidgets] = useState<DashboardWidget[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [containerWidth, setContainerWidth] = useState(1200);

  const fetchWidgets = useCallback(async () => {
    if (!user) return;
    try {
      const data = await getWidgets();
      setWidgets(data);
    } catch (err) {
      console.error("Failed to fetch widgets:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchWidgets();
  }, [fetchWidgets]);

  useEffect(() => {
    const updateWidth = () => {
      const container = document.querySelector(".dashboard-container");
      if (container) {
        setContainerWidth(container.clientWidth - 32);
      }
    };
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  const handleLayoutChange = useCallback(
    async (newLayout: Layout[]) => {
      if (!user) return;

      const updates = newLayout.map((item) => ({
        id: item.i,
        layout: { x: item.x, y: item.y, w: item.w, h: item.h },
      }));

      setWidgets((prev) =>
        prev.map((w) => {
          const layoutItem = newLayout.find((l) => l.i === w.id);
          if (layoutItem) {
            return {
              ...w,
              layout: { x: layoutItem.x, y: layoutItem.y, w: layoutItem.w, h: layoutItem.h },
            };
          }
          return w;
        })
      );

      try {
        await batchUpdateLayouts(updates);
      } catch (err) {
        console.error("Failed to save layout:", err);
      }
    },
    [user]
  );

  const handleAddWidget = async (widgetType: string) => {
    if (!user) return;
    try {
      const maxY = widgets.reduce((max, w) => Math.max(max, w.layout.y + w.layout.h), 0);
      const newWidget = await addWidget(widgetType, undefined, {
        x: 0,
        y: maxY,
        w: 4,
        h: 3,
      });
      setWidgets((prev) => [...prev, newWidget]);
      setShowPicker(false);
    } catch (err) {
      console.error("Failed to add widget:", err);
    }
  };

  const handleRemoveWidget = async (widgetId: string) => {
    if (!user) return;
    try {
      await deleteWidget(widgetId);
      setWidgets((prev) => prev.filter((w) => w.id !== widgetId));
    } catch (err) {
      console.error("Failed to remove widget:", err);
    }
  };

  const gridLayout: Layout[] = widgets.map((w) => ({
    i: w.id,
    x: w.layout.x,
    y: w.layout.y,
    w: w.layout.w,
    h: w.layout.h,
    minW: 2,
    minH: 2,
  }));

  return (
    <div className="dashboard-container" data-testid="customizable-dashboard">
      <div className="dashboard-header">
        <div>
          <h1>Dashboard</h1>
          <p className="dashboard-subtitle">
            Welcome back, {user?.employee?.firstName || "User"}. Customize your dashboard by adding widgets.
          </p>
        </div>
        <button
          className="dashboard-add-btn"
          onClick={() => setShowPicker(true)}
          data-testid="btn-add-widget"
        >
          + Add Widget
        </button>
      </div>

      {loading ? (
        <div className="dashboard-loading">Loading dashboard...</div>
      ) : widgets.length === 0 ? (
        <div className="dashboard-empty">
          <div className="dashboard-empty-icon">📊</div>
          <h3>Your dashboard is empty</h3>
          <p>Add widgets to customize your view and track important metrics.</p>
          <button
            className="dashboard-add-btn"
            onClick={() => setShowPicker(true)}
            data-testid="btn-add-widget-empty"
          >
            + Add Your First Widget
          </button>
        </div>
      ) : (
        <GridLayout
          className="dashboard-grid"
          layout={gridLayout}
          cols={12}
          rowHeight={80}
          width={containerWidth}
          onLayoutChange={handleLayoutChange}
          draggableHandle=".widget-header"
          compactType="vertical"
          preventCollision={false}
        >
          {widgets.map((widget) => {
            const WidgetComponent = WIDGET_COMPONENTS[widget.widgetType];
            if (!WidgetComponent) return null;
            return (
              <div key={widget.id} className="widget-card" data-testid={`widget-card-${widget.id}`}>
                <WidgetComponent onRemove={() => handleRemoveWidget(widget.id)} />
              </div>
            );
          })}
        </GridLayout>
      )}

      {showPicker && (
        <WidgetPicker
          existingTypes={widgets.map((w) => w.widgetType)}
          onAdd={handleAddWidget}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
