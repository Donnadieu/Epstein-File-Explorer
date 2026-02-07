import { useState, useCallback } from "react";

const STORAGE_KEY = "epstein-search-history";
const MAX_HISTORY = 5;

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

export function useSearchHistory() {
  const [history, setHistory] = useState<string[]>(loadHistory);

  const addSearch = useCallback((query: string) => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    setHistory((prev) => {
      const filtered = prev.filter((item) => item !== trimmed);
      const next = [trimmed, ...filtered].slice(0, MAX_HISTORY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setHistory([]);
  }, []);

  return { history, addSearch, clearHistory };
}
