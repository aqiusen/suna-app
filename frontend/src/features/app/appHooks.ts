import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Theme } from "../../lib/models";
import { useMediaQuery } from "../../lib/useMediaQuery";

export function useTheme() {
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = window.localStorage.getItem("suna-theme");
    return saved === "light" || saved === "dark" || saved === "system"
      ? saved
      : "system";
  });
  const resolvedTheme =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;

  const toggleTheme = useCallback(() => {
    const next = resolvedTheme === "dark" ? "light" : "dark";
    const apply = () => {
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => void;
    };
    if (doc.startViewTransition) doc.startViewTransition(apply);
    else apply();
  }, [resolvedTheme]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute(
        "content",
        resolvedTheme === "dark" ? "#10141e" : "#f5f7fb",
      );
    }
    window.localStorage.setItem("suna-theme", theme);
  }, [resolvedTheme, theme]);

  return { theme, setTheme, resolvedTheme, toggleTheme };
}

export function useDetailsOpen(isMobile: boolean) {
  const [detailsOpen, setDetailsOpen] = useState(() => !isMobile);
  useEffect(() => {
    if (isMobile) setDetailsOpen(false);
  }, [isMobile]);
  return [detailsOpen, setDetailsOpen] as const;
}

export function useGlobalShortcuts({
  setCommandOpen,
  setCreateOpen,
  setSettingsOpen,
}: {
  setCommandOpen: Dispatch<SetStateAction<boolean>>;
  setCreateOpen: Dispatch<SetStateAction<boolean>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((value) => !value);
        return;
      }
      if (mod && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setCreateOpen(true);
        return;
      }
      if (mod && event.key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [setCommandOpen, setCreateOpen, setSettingsOpen]);
}

export function useHashRouting({
  attach,
  connected,
  selectedId,
}: {
  attach: (id: string, joinActive?: boolean) => Promise<void>;
  connected: boolean;
  selectedId?: string;
}) {
  useEffect(() => {
    const applyHash = () => {
      if (!connected) return;
      const match = window.location.hash.match(/^#\/session\/(.+)$/);
      const target = match ? decodeURIComponent(match[1]) : undefined;
      if (target && target !== selectedId) void attach(target);
    };
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [attach, connected, selectedId]);

  // 连接建立后（含刷新恢复）应用一次当前 hash。
  useEffect(() => {
    if (!connected) return;
    const match = window.location.hash.match(/^#\/session\/(.+)$/);
    const target = match ? decodeURIComponent(match[1]) : undefined;
    if (target && target !== selectedId) void attach(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  useEffect(() => {
    const target = selectedId
      ? `#/session/${encodeURIComponent(selectedId)}`
      : "#/";
    if (window.location.hash !== target) {
      window.history.replaceState(null, "", target);
    }
  }, [selectedId]);
}
