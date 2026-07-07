import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Kanban } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { HqLoading } from "../HqLoading";
import { formatCurrency, formatDateTime } from "../../../utils/safeFormat";
import { useGrantManage } from "../../../hooks/useGrantManage";

const fmt = formatCurrency;

type EntityType = "opportunity" | "application" | "award";

export const GrantV5PipelineKanban: React.FC = () => {
  const qc = useQueryClient();
  const { canManage } = useGrantManage();
  const [selected, setSelected] = useState<{ id: string; entityType: EntityType; stageKey: string } | null>(null);
  const [targetStage, setTargetStage] = useState("");

  const board = useQuery({
    queryKey: ["grant-v5-pipeline-board"],
    queryFn: grantsApi.v5PipelineBoard,
    staleTime: 30_000,
  });

  const transition = useMutation({
    mutationFn: grantsApi.v5PipelineTransition,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grant-v5-pipeline-board"] });
      qc.invalidateQueries({ queryKey: ["grant-v5-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["grant-v5-pipeline"] });
      setSelected(null);
      setTargetStage("");
    },
  });

  if (board.isLoading) return <HqLoading message="Loading pipeline board…" />;

  const columns = board.data?.columns ?? [];
  const stageOptions = columns.map((c) => ({ key: c.stageKey, label: c.label }));

  return (
    <HqPanel
      title="Pipeline Kanban"
      subtitle="System of record — opportunities, applications, and awards across lifecycle stages"
    >
      <div className="hq-pipeline-board">
        {columns.map((col) => (
          <div key={col.stageKey} className="hq-pipeline-column">
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <strong style={{ fontSize: "0.85rem" }}>{col.label}</strong>
              <span className="hq-muted-text" style={{ fontSize: "0.75rem" }}>{col.count}</span>
            </div>
            <div className="hq-muted-text" style={{ fontSize: "0.75rem", marginBottom: "0.75rem" }}>
              {fmt(col.value)}
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {col.items.map((item) => (
                <li key={`${item.entityType}-${item.id}`}>
                  <button
                    type="button"
                    className="hq-btn hq-btn-ghost"
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "0.5rem",
                      border: selected?.id === item.id ? "1px solid var(--hq-gold)" : "1px solid var(--hq-border)",
                      borderRadius: 6,
                    }}
                    onClick={() => {
                      setSelected({ id: item.id, entityType: item.entityType, stageKey: col.stageKey });
                      setTargetStage("");
                    }}
                  >
                    <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>{item.title}</div>
                    <div className="hq-muted-text" style={{ fontSize: "0.7rem" }}>
                      {item.entityType} · {fmt(item.amount)}
                    </div>
                    {item.deadline && (
                      <div className="hq-muted-text" style={{ fontSize: "0.7rem" }}>
                        Due {formatDateTime(item.deadline)}
                      </div>
                    )}
                  </button>
                </li>
              ))}
              {!col.items.length && <li className="hq-muted-text" style={{ fontSize: "0.75rem" }}>No items</li>}
            </ul>
          </div>
        ))}
      </div>

      {selected && canManage && (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.75rem",
            borderRadius: 8,
            border: "1px solid var(--hq-border)",
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem",
            alignItems: "center",
          }}
        >
          <Kanban size={16} />
          <span style={{ fontSize: "0.85rem" }}>
            Move <strong>{selected.entityType}</strong> to stage:
          </span>
          <select
            className="hq-input"
            value={targetStage}
            onChange={(e) => setTargetStage(e.target.value)}
            style={{ minWidth: 200 }}
          >
            <option value="">Select stage…</option>
            {stageOptions
              .filter((s) => s.key !== selected.stageKey)
              .map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
          </select>
          <button
            type="button"
            className="hq-btn hq-btn-primary hq-btn-sm"
            disabled={!targetStage || transition.isPending}
            onClick={() =>
              transition.mutate({
                entityType: selected.entityType,
                entityId: selected.id,
                toStage: targetStage,
              })
            }
          >
            <ArrowRight size={14} /> {transition.isPending ? "Moving…" : "Transition"}
          </button>
          {transition.isError && (
            <span style={{ color: "var(--hq-danger)", fontSize: "0.8rem" }}>
              {(transition.error as Error).message}
            </span>
          )}
        </div>
      )}
    </HqPanel>
  );
};
