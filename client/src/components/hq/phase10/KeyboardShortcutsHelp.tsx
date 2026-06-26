import React from "react";
import { X } from "lucide-react";

interface ShortcutRow {
  keys: string[];
  action: string;
}

interface KeyboardShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
  shortcuts?: ShortcutRow[];
}

const DEFAULT_SHORTCUTS: ShortcutRow[] = [
  { keys: ["⌘", "K"], action: "Open command palette / universal search" },
  { keys: ["?"], action: "Show this help" },
  { keys: ["G", "H"], action: "Mission Control" },
  { keys: ["G", "A"], action: "AURA Command Center" },
  { keys: ["G", "F"], action: "Financial Center" },
  { keys: ["G", "G"], action: "Grant Center" },
  { keys: ["G", "P"], action: "People Management" },
  { keys: ["G", "W"], action: "Workflow Automation" },
  { keys: ["Esc"], action: "Close dialogs" },
];

export const KeyboardShortcutsHelp: React.FC<KeyboardShortcutsHelpProps> = ({
  open,
  onClose,
  shortcuts = DEFAULT_SHORTCUTS,
}) => {
  if (!open) return null;

  return (
    <div className="hq-command-overlay" onClick={onClose} role="presentation">
      <div className="hq-shortcuts-modal hq-fade-in" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Keyboard shortcuts">
        <div className="hq-shortcuts-header">
          <h3>Keyboard Shortcuts</h3>
          <button type="button" className="hq-login-briefing-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <ul className="hq-shortcuts-list">
          {shortcuts.map((s) => (
            <li key={s.action}>
              <span className="hq-shortcuts-keys">
                {s.keys.map((k) => <kbd key={k}>{k}</kbd>)}
              </span>
              <span>{s.action}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
