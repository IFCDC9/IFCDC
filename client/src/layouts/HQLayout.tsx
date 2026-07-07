import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X, Bell, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { HQ_NAV_ITEMS, HQ_NAV_SECTIONS } from "../config/hqNavigation";
import { CommandPalette, useCommandPalette } from "../components/hq/CommandPalette";
import { KeyboardShortcutsHelp } from "../components/hq/phase10/KeyboardShortcutsHelp";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { HqMobileNav } from "../components/hq/HqMobileNav";
import { useHqRealtime } from "../hooks/useHqRealtime";
import { enterpriseApi } from "../api/enterpriseApi";
import { ExecutiveLoginBriefing } from "../components/hq/ExecutiveLoginBriefing";

interface HQLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}

function navPathBase(path: string): string {
  return path.split("?")[0];
}

const HQLayout: React.FC<HQLayoutProps> = ({
  children,
  title = "IFCDC Headquarters",
  subtitle = "Enterprise Operating System",
}) => {
  const { user, canAccessRoute } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const command = useCommandPalette();
  useKeyboardShortcuts({
    onCommandPalette: command.toggle,
    onShowHelp: () => setShortcutsOpen(true),
  });
  const { connected: realtimeConnected } = useHqRealtime();

  const { data: notifData } = useQuery({
    queryKey: ["enterprise-notif-count"],
    queryFn: enterpriseApi.notifications,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const unreadCount = notifData?.unreadCount ?? 0;

  const isActive = (path: string) => {
    const base = navPathBase(path);
    const locBase = location.pathname;
    if (base === "/hq") return locBase === "/hq";
    if (locBase === base) return true;
    if (locBase.startsWith(`${base}/`)) return true;
    if (path.includes("?") && locBase === base) {
      const params = new URLSearchParams(path.split("?")[1]);
      const current = new URLSearchParams(location.search);
      for (const [k, v] of params.entries()) {
        if (current.get(k) === v) return true;
      }
    }
    return false;
  };

  const displayName = user?.employee
    ? `${user.employee.firstName} ${user.employee.lastName}`
    : user?.email ?? "User";

  const closeSidebar = () => setSidebarOpen(false);

  useEffect(() => {
    if (sidebarOpen) {
      document.body.classList.add("hq-nav-open");
    } else {
      document.body.classList.remove("hq-nav-open");
    }
    return () => document.body.classList.remove("hq-nav-open");
  }, [sidebarOpen]);

  return (
    <div className="hq-shell">
      <CommandPalette open={command.open} onClose={command.close} />
      <KeyboardShortcutsHelp open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <div
        className={`hq-sidebar-overlay ${sidebarOpen ? "open" : ""}`}
        onClick={closeSidebar}
        aria-hidden="true"
      />

      <aside className={`hq-sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="hq-sidebar-brand">
          <Link to="/hq" className="hq-sidebar-logo-link" onClick={closeSidebar}>
            <div className="hq-sidebar-logo">IFCDC HQ</div>
            <div className="hq-sidebar-tagline">Enterprise Operating System</div>
          </Link>
        </div>

        <nav className="hq-sidebar-nav">
          {HQ_NAV_SECTIONS.map((section) => {
            const items = HQ_NAV_ITEMS.filter((item) => canAccessRoute(navPathBase(item.path)));
            const sectionItems = items.filter((item) => item.section === section);
            if (!sectionItems.length) return null;
            return (
              <div key={section} className="hq-nav-section">
                <div className="hq-nav-section-label">{section}</div>
                {sectionItems.map((item) => {
                  const Icon = item.icon;
                  const showBadge = item.path === "/hq/notifications" && unreadCount > 0;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`hq-nav-link ${isActive(item.path) ? "active" : ""}`}
                      onClick={closeSidebar}
                    >
                      <Icon size={18} />
                      <span>{item.label}</span>
                      {showBadge && <span className="hq-nav-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="hq-sidebar-user">
          <div className="hq-sidebar-user-name">{displayName}</div>
          <div className="hq-sidebar-user-role">{user?.enterpriseRoleLabel ?? user?.role}</div>
        </div>
      </aside>

      <div className="hq-main">
        <header className="hq-topbar">
          <div className="hq-topbar-left">
            <button
              type="button"
              className="hq-menu-toggle"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Toggle navigation"
            >
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <div className="hq-topbar-title-wrap" style={{ minWidth: 0 }}>
              <div className="hq-page-title hq-page-title-truncate">{title}</div>
              <div className="hq-page-subtitle">{subtitle}</div>
            </div>
          </div>

          <div className="hq-topbar-right">
            <button
              type="button"
              className="hq-topbar-btn hq-command-trigger"
              onClick={command.toggle}
              aria-label="Search Headquarters"
            >
              <Search size={16} />
              <span className="hq-command-trigger-label">Search</span>
              <kbd className="hq-command-kbd">⌘K</kbd>
            </button>
            <Link to="/hq/notifications" className="hq-topbar-btn" aria-label="Notifications">
              <Bell size={16} />
              {unreadCount > 0 && <span className="hq-notif-dot" />}
            </Link>
            {realtimeConnected && (
              <span className="hq-ws-indicator" title="Real-time updates active">
                <span className="hq-live-dot" />
              </span>
            )}
          </div>
        </header>

        <div className="hq-content">
          <ExecutiveLoginBriefing />
          {children}
        </div>
      </div>

      <HqMobileNav onSearch={command.toggle} />
    </div>
  );
};

export default HQLayout;
