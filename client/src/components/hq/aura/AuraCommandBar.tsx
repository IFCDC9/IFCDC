import React, { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { AuraExecutiveChatWorkspace } from "./AuraExecutiveChatWorkspace";
import { AURA_OPEN_EVENT, type AuraOpenDetail } from "./auraBus";

/**
 * Floating AURA entry + fullscreen Enterprise Workspace drawer.
 * Long reports scroll indefinitely; jobs keep processing with live status.
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
        if (detail.prefill) {
          /* workspace loads; user can edit — prefill handled by opening input focus */
        }
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

  return (
    <>
      {!open && (
        <button
          type="button"
          className="hq-aura-fab"
          onClick={() => {
            setModule(undefined);
            setContextRef(undefined);
            setAutoCommand(undefined);
            setSession((s) => s + 1);
            setOpen(true);
          }}
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
}

export default AuraCommandBar;
