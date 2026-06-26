import { useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";

type ShortcutHandler = () => void;

const GOTO_ROUTES: Record<string, string> = {
  h: "/hq/phase10",
  a: "/hq/aura",
  f: "/hq/finance",
  g: "/hq/grants",
  p: "/hq/people",
  w: "/hq/workflows",
  n: "/hq/notifications",
  i: "/hq/intelligence",
};

export function useKeyboardShortcuts(opts?: {
  onCommandPalette?: () => void;
  onShowHelp?: () => void;
}) {
  const navigate = useNavigate();
  const pendingGoto = useRef<string | null>(null);
  const gotoTimer = useRef<ReturnType<typeof setTimeout>>();

  const go = useCallback((path: string) => navigate(path), [navigate]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        opts?.onCommandPalette?.();
        return;
      }

      if (typing) return;

      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        opts?.onShowHelp?.();
        return;
      }

      if (e.key === "g" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        pendingGoto.current = "g";
        clearTimeout(gotoTimer.current);
        gotoTimer.current = setTimeout(() => { pendingGoto.current = null; }, 1200);
        return;
      }

      if (pendingGoto.current === "g" && GOTO_ROUTES[e.key]) {
        e.preventDefault();
        const path = GOTO_ROUTES[e.key];
        pendingGoto.current = null;
        clearTimeout(gotoTimer.current);
        go(path);
      }
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      clearTimeout(gotoTimer.current);
    };
  }, [go, opts?.onCommandPalette, opts?.onShowHelp]);
}
