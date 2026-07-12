import React, { useState, useEffect, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import GridLayoutImport, { Layout } from "react-grid-layout";
import { Plus, X, LayoutGrid, Cloud, CloudOff, LayoutTemplate } from "lucide-react";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  EXECUTIVE_WIDGET_CATALOG,
  defaultWidgetLayout,
  saveExecutiveWidgetsLocal,
  loadExecutiveWidgetsLocal,
  type StoredWidgetLayout,
} from "../../config/executiveWidgets";
import { workspaceApi, type UserWorkspace } from "../../api/workspaceApi";
import { ExecutiveWidgetContent } from "./ExecutiveWidgetContent";
import { HqWidgetErrorBoundary } from "./HqErrorBoundary";

function normalizeWidgets(raw: unknown): StoredWidgetLayout[] {
  if (!Array.isArray(raw)) return defaultWidgetLayout();
  const valid = raw.filter(
    (w): w is StoredWidgetLayout =>
      !!w &&
      typeof w === "object" &&
      typeof (w as StoredWidgetLayout).id === "string" &&
      EXECUTIVE_WIDGET_CATALOG.some((c) => c.id === (w as StoredWidgetLayout).id) &&
      !!(w as StoredWidgetLayout).layout &&
      typeof (w as StoredWidgetLayout).layout.x === "number" &&
      typeof (w as StoredWidgetLayout).layout.y === "number" &&
      typeof (w as StoredWidgetLayout).layout.w === "number" &&
      typeof (w as StoredWidgetLayout).layout.h === "number"
  );
  return valid.length ? valid : defaultWidgetLayout();
}

interface ExecutiveWidgetDashboardProps {
  dashboardMode: "standard" | "custom";
  initialWorkspace?: UserWorkspace | null;
}

const GridLayout = (GridLayoutImport as unknown as { default?: typeof GridLayoutImport }).default ?? GridLayoutImport;

export const ExecutiveWidgetDashboard: React.FC<ExecutiveWidgetDashboardProps> = ({ dashboardMode, initialWorkspace }) => {
  const [widgets, setWidgets] = useState<StoredWidgetLayout[]>(() => {
    if (initialWorkspace?.widgets?.length) return normalizeWidgets(initialWorkspace.widgets);
    return loadExecutiveWidgetsLocal();
  });
  const [showPicker, setShowPicker] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [width, setWidth] = useState(1200);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "offline">("idle");
  const [loaded, setLoaded] = useState(!!initialWorkspace);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (initialWorkspace) {
      if (initialWorkspace.widgets?.length) setWidgets(normalizeWidgets(initialWorkspace.widgets));
      setLoaded(true);
      return;
    }
    workspaceApi.load()
      .then((ws) => {
        if (ws.widgets?.length) setWidgets(normalizeWidgets(ws.widgets));
        setLoaded(true);
      })
      .catch(() => {
        setWidgets(loadExecutiveWidgetsLocal());
        setLoaded(true);
        setSaveState("offline");
      });
  }, [initialWorkspace]);

  useEffect(() => {
    const update = () => {
      const el = document.querySelector(".hq-widget-grid-container");
      if (el) setWidth(el.clientWidth);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const persist = useCallback((next: StoredWidgetLayout[], mode = dashboardMode) => {
    saveExecutiveWidgetsLocal(next);
    setSaveState("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      workspaceApi.save({ dashboardMode: mode, widgets: next })
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("offline"));
    }, 600);
  }, [dashboardMode]);

  const safeWidgets = Array.isArray(widgets) ? widgets : defaultWidgetLayout();

  const gridLayout: Layout[] = safeWidgets.map((w) => ({
    i: w.id,
    x: w.layout.x,
    y: w.layout.y,
    w: w.layout.w,
    h: w.layout.h,
    minW: EXECUTIVE_WIDGET_CATALOG.find((c) => c.id === w.id)?.defaultLayout.minW ?? 2,
    minH: EXECUTIVE_WIDGET_CATALOG.find((c) => c.id === w.id)?.defaultLayout.minH ?? 2,
  }));

  const handleLayoutChange = useCallback((layout: Layout[]) => {
    setWidgets((prev) => {
      const updated = prev.map((w) => {
        const item = layout.find((l) => l.i === w.id);
        if (!item) return w;
        return { ...w, layout: { x: item.x, y: item.y, w: item.w, h: item.h } };
      });
      persist(updated);
      return updated;
    });
  }, [persist]);

  const addWidget = (id: string) => {
    if (widgets.some((w) => w.id === id)) return;
    const def = EXECUTIVE_WIDGET_CATALOG.find((w) => w.id === id);
    if (!def) return;
    const maxY = widgets.reduce((m, w) => Math.max(m, w.layout.y + w.layout.h), 0);
    const next = [...widgets, { id, layout: { x: 0, y: maxY, w: def.defaultLayout.w, h: def.defaultLayout.h } }];
    setWidgets(next);
    persist(next);
    setShowPicker(false);
  };

  const removeWidget = (id: string) => {
    const next = widgets.filter((w) => w.id !== id);
    setWidgets(next);
    persist(next);
  };

  const resetWidgets = () => {
    workspaceApi.applyTemplate()
      .then((ws) => {
        setWidgets(normalizeWidgets(ws.widgets));
        persist(normalizeWidgets(ws.widgets));
      })
      .catch(() => {
        const defaults = defaultWidgetLayout();
        setWidgets(defaults);
        persist(defaults);
      });
  };

  const applyTemplateKey = (templateKey: string) => {
    workspaceApi.applyTemplate(templateKey)
      .then((ws) => {
        setWidgets(normalizeWidgets(ws.widgets));
        persist(normalizeWidgets(ws.widgets));
        setShowTemplates(false);
      })
      .catch(() => setShowTemplates(false));
  };

  const templatesQuery = useQuery({
    queryKey: ["workspace-templates"],
    queryFn: () => workspaceApi.templates(),
    enabled: showTemplates,
  });

  const available = EXECUTIVE_WIDGET_CATALOG.filter((c) => !widgets.some((w) => w.id === c.id));

  if (!loaded) {
    return <div className="hq-muted-text" style={{ padding: "2rem" }}>Loading your personalized workspace…</div>;
  }

  return (
    <div className="hq-widget-dashboard">
      <div className="hq-widget-toolbar">
        <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" onClick={() => setShowPicker(true)}>
          <Plus size={14} /> Add Widget
        </button>
        <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => setShowTemplates(true)}>
          <LayoutTemplate size={14} /> Apply Template
        </button>
        <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={resetWidgets}>
          <LayoutGrid size={14} /> Reset Role Default
        </button>
        <span className="hq-widget-save-status">
          {saveState === "saving" && <><Cloud size={14} className="hq-spinner" /> Saving…</>}
          {saveState === "saved" && <><Cloud size={14} /> Saved to your workspace</>}
          {saveState === "offline" && <><CloudOff size={14} /> Saved locally (offline)</>}
        </span>
        <span className="hq-widget-toolbar-hint"><LayoutGrid size={14} /> Drag to rearrange · Resize from corners</span>
      </div>

      {showTemplates && (
        <div className="hq-modal-overlay" onClick={() => setShowTemplates(false)} role="presentation">
          <div className="hq-modal hq-widget-picker" onClick={(e) => e.stopPropagation()}>
            <h3>Apply Dashboard Template</h3>
            <div className="hq-widget-picker-grid">
              {(templatesQuery.data?.templates ?? []).map((t) => (
                <button key={t.key} type="button" className="hq-widget-picker-item" onClick={() => applyTemplateKey(t.key)}>
                  <strong>{t.name}</strong>
                  <span>{t.description} · {t.widgetCount} widgets</span>
                </button>
              ))}
              {templatesQuery.isLoading && <p className="hq-muted-text">Loading templates…</p>}
            </div>
          </div>
        </div>
      )}

      {showPicker && (
        <div className="hq-modal-overlay" onClick={() => setShowPicker(false)} role="presentation">
          <div className="hq-modal hq-widget-picker" onClick={(e) => e.stopPropagation()}>
            <h3>Add Dashboard Widget</h3>
            <div className="hq-widget-picker-grid">
              {available.map((w) => (
                <button key={w.id} type="button" className="hq-widget-picker-item" onClick={() => addWidget(w.id)}>
                  <strong>{w.name}</strong>
                  <span>{w.description}</span>
                </button>
              ))}
              {available.length === 0 && <p className="hq-muted-text">All widgets are on your dashboard.</p>}
            </div>
          </div>
        </div>
      )}

      <div className="hq-widget-grid-container">
        <GridLayout
          className="hq-widget-grid"
          layout={gridLayout}
          cols={12}
          rowHeight={60}
          width={width}
          onLayoutChange={handleLayoutChange}
          draggableHandle=".hq-widget-drag-handle"
          compactType="vertical"
          margin={[12, 12]}
        >
          {safeWidgets.map((w) => {
            const def = EXECUTIVE_WIDGET_CATALOG.find((c) => c.id === w.id);
            return (
              <div key={w.id} className="hq-widget-card hq-stagger-in">
                <div className="hq-widget-card-header hq-widget-drag-handle">
                  <span>{def?.name ?? w.id}</span>
                  <button type="button" className="hq-widget-remove" onClick={() => removeWidget(w.id)} aria-label="Remove widget">
                    <X size={14} />
                  </button>
                </div>
                <div className="hq-widget-card-body">
                  <HqWidgetErrorBoundary label={def?.name ?? w.id}>
                    <ExecutiveWidgetContent widgetId={w.id} />
                  </HqWidgetErrorBoundary>
                </div>
              </div>
            );
          })}
        </GridLayout>
      </div>
    </div>
  );
};
