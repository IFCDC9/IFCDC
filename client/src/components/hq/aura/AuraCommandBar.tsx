import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";
import { AuraExecutiveChatWorkspace } from "./AuraExecutiveChatWorkspace";
import { AURA_OPEN_EVENT, type AuraOpenDetail } from "./auraBus";

/**
 * Floating AURA entry + fullscreen Enterprise Workspace drawer.
 * Portaled to document.body so Grant Center stacking/transforms never block clicks.
 */
export function AuraCommandBar(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [module, setModule] = useState<string | undefined>();
  const [contextRef, setContextRef] = useState<Record<string, unknown> | undefined>();
  const [autoCommand, setAutoCommand] = useState<
    { text?: string; actionId?: string; args?: Record<string, unknown>; label?: string } | undefined
  >();
  const [session, setSession] = useState(0);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<AuraOpenDetail>).detail ?? {};
      setModule(detail.module);
      setContextRef(detail.contextRef);
      setSession((s) => s + 1);
      if (detail.actionId) {
        setAutoCommand({
          actionId: detail.actionId,
          args: detail.args,
          text: detail.prefill,
          label: detail.prefill,
        });
      } else if (detail.prefill && detail.autoRun) {
        setAutoCommand({ text: detail.prefill });
      } else {
        setAutoCommand(undefined);
      }
      setOpen(true);
    };
    window.addEventListener(AURA_OPEN_EVENT, handler);
    return () => window.removeEventListener(AURA_OPEN_EVENT, handler);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const openDrawer = () => {
    setModule(undefined);
    setContextRef(undefined);
    setAutoCommand(undefined);
    setSession((s) => s + 1);
    setOpen(true);
  };

  const ui = (
    <>
      {!open && (
        <button
          type="button"
          className="hq-aura-fab"
          onClick={openDrawer}
          aria-label="Ask AURA"
          title="Ask AURA"
        >
          <Sparkles size={22} />
        </button>
      )}

      {open && (
        <div className="hq-aura-workspace-overlay" role="dialog" aria-modal="true" aria-label="AURA Executive Workspace">
          <button type="button" className="hq-aura-workspace-backdrop" aria-label="Close AURA" onClick={() => setOpen(false)} />
          <AuraExecutiveChatWorkspace
            key={`drawer-${session}`}
            variant="drawer"
            module={module}
            contextRef={contextRef}
            autoCommand={autoCommand}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </>
  );

  if (typeof document === "undefined") return ui;
  return createPortal(ui, document.body);
}

export default AuraCommandBar;
