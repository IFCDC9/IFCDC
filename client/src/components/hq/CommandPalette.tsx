import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Search, LayoutDashboard, Users, FileText, LayoutGrid, ArrowRight, Wallet, Receipt, Handshake, Shield, FolderOpen } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { enterpriseApi, type EnterpriseSearchResult } from "../../api/enterpriseApi";
import { HQ_NAV_ITEMS } from "../../config/hqNavigation";

const TYPE_ICONS: Record<string, React.ElementType> = {
  module: LayoutDashboard,
  person: Users,
  grant: FileText,
  program: LayoutGrid,
  page: LayoutDashboard,
  document: FolderOpen,
  application: FileText,
  invoice: Receipt,
  expense: Wallet,
  funder: Handshake,
  compliance: Shield,
};

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose }) => {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isFetching } = useQuery({
    queryKey: ["enterprise-search", debouncedQuery],
    queryFn: () => enterpriseApi.search(debouncedQuery),
    enabled: open && debouncedQuery.length >= 2,
    staleTime: 15_000,
  });

  const defaultResults: EnterpriseSearchResult[] = query.length === 0
    ? HQ_NAV_ITEMS.slice(0, 8).map((item) => ({
        type: "module" as const,
        id: item.path,
        title: item.label,
        subtitle: item.section,
        path: item.path,
      }))
    : [];

  const results = debouncedQuery.length >= 2 ? (data?.results ?? []) : defaultResults;

  const go = useCallback((path: string) => {
    navigate(path);
    onClose();
    setQuery("");
  }, [navigate, onClose]);

  useEffect(() => {
    if (open) {
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, results.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
      if (e.key === "Enter" && results[selected]) go(results[selected].path);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, results, selected, go, onClose]);

  if (!open) return null;

  return (
    <div className="hq-command-overlay" onClick={onClose} role="presentation">
      <div className="hq-command-palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="hq-command-input-row">
          <Search size={18} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search modules, people, grants, programs…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="hq-command-input"
          />
          <kbd className="hq-command-kbd">esc</kbd>
        </div>

        <div className="hq-command-results">
          {isFetching && debouncedQuery.length >= 2 && (
            <div className="hq-command-empty">Searching…</div>
          )}
          {!isFetching && results.length === 0 && debouncedQuery.length >= 2 && (
            <div className="hq-command-empty">No results for &ldquo;{query}&rdquo;</div>
          )}
          {results.map((r, i) => {
            const Icon = TYPE_ICONS[r.type] ?? LayoutDashboard;
            return (
              <button
                key={`${r.type}-${r.id}`}
                type="button"
                className={`hq-command-item ${i === selected ? "selected" : ""}`}
                onClick={() => go(r.path)}
                onMouseEnter={() => setSelected(i)}
              >
                <Icon size={16} />
                <div className="hq-command-item-text">
                  <span className="hq-command-item-title">{r.title}</span>
                  <span className="hq-command-item-sub">{r.subtitle}</span>
                </div>
                <ArrowRight size={14} className="hq-command-item-arrow" />
              </button>
            );
          })}
        </div>

        <div className="hq-command-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>⌘K</kbd> search</span>
          <span><kbd>?</kbd> shortcuts</span>
        </div>
      </div>
    </div>
  );
};

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  return { open, setOpen, toggle: () => setOpen((v) => !v), close: () => setOpen(false) };
}
