import { useEffect, useCallback, useState, useRef } from "react";

export interface ShortcutDef {
  keys: string;
  label: string;
  action: () => void;
}

export function useKeyboardShortcuts(navigate: (path: string) => void) {
  const [showHelp, setShowHelp] = useState(false);
  const pendingGRef = useRef(false);

  const closeHelp = useCallback(() => setShowHelp(false), []);

  useEffect(() => {
    let gTimer: ReturnType<typeof setTimeout> | null = null;

    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;

      // Esc always works — close modals/help
      if (e.key === "Escape") {
        setShowHelp(false);
        return;
      }

      // Cmd+K works everywhere
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        navigate("/search");
        return;
      }

      // All other shortcuts only when not in a text field
      if (isInput) return;

      if (e.key === "/") {
        e.preventDefault();
        navigate("/search");
        return;
      }

      if (e.key === "?") {
        e.preventDefault();
        setShowHelp((v) => !v);
        return;
      }

      // "g" prefix shortcuts (two-key chords)
      if (e.key === "g" && !pendingGRef.current) {
        pendingGRef.current = true;
        gTimer = setTimeout(() => { pendingGRef.current = false; }, 800);
        return;
      }

      if (pendingGRef.current) {
        pendingGRef.current = false;
        if (gTimer) clearTimeout(gTimer);

        const gMap: Record<string, string> = {
          p: "/people",
          d: "/documents",
          t: "/timeline",
          n: "/network",
          h: "/",
          s: "/search",
        };

        const dest = gMap[e.key];
        if (dest) {
          e.preventDefault();
          navigate(dest);
        }
      }
    }

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      if (gTimer) clearTimeout(gTimer);
    };
  }, [navigate]);

  return { showHelp, closeHelp };
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? "Cmd" : "Ctrl";

export const shortcutsList: { keys: string; label: string }[] = [
  { keys: "/", label: "Focus search" },
  { keys: `${modKey}+K`, label: "Focus search (from anywhere)" },
  { keys: "g p", label: "Go to People" },
  { keys: "g d", label: "Go to Documents" },
  { keys: "g t", label: "Go to Timeline" },
  { keys: "g n", label: "Go to Network" },
  { keys: "g h", label: "Go to Home" },
  { keys: "g s", label: "Go to Search" },
  { keys: "?", label: "Show keyboard shortcuts" },
  { keys: "Esc", label: "Close modal / dialog" },
];
