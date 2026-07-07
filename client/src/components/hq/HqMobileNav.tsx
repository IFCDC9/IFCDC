import React from "react";
import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, FileText, Wallet, Sparkles, Bell, Search } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";

const MOBILE_NAV = [
  { path: "/hq", icon: LayoutDashboard, label: "Home" },
  { path: "/hq/grants", icon: FileText, label: "Grants" },
  { path: "/hq/finance", icon: Wallet, label: "Finance" },
  { path: "/hq/aura", icon: Sparkles, label: "AURA" },
  { path: "/hq/notifications", icon: Bell, label: "Alerts" },
  { path: "__search__", icon: Search, label: "Search" },
];

export const HqMobileNav: React.FC<{ onSearch?: () => void }> = ({ onSearch }) => {
  const location = useLocation();
  const { user, canAccessRoute } = useAuth();

  const isActive = (path: string) => {
    if (path === "/hq") return location.pathname === "/hq";
    return location.pathname.startsWith(path);
  };

  const visible = MOBILE_NAV.filter((item) => {
    if (item.path === "__search__") return Boolean(onSearch);
    return user && canAccessRoute(item.path);
  });

  return (
    <nav className="hq-mobile-nav" aria-label="Mobile navigation">
      {visible.map((item) => {
        const Icon = item.icon;
        if (item.path === "__search__") {
          return (
            <button
              key="search"
              type="button"
              className="hq-mobile-nav-item"
              onClick={onSearch}
              aria-label="Search Headquarters"
            >
              <Icon size={20} />
              <span>{item.label}</span>
            </button>
          );
        }
        return (
          <Link key={item.path} to={item.path} className={`hq-mobile-nav-item ${isActive(item.path) ? "active" : ""}`}>
            <Icon size={20} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
};
