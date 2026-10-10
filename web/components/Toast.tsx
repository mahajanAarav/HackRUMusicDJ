"use client";
import { useCallback, useEffect, useState } from "react";

export function useToast() {
  const [t, setT] = useState<{ id: number; msg: string; kind: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!t) return;
    const h = setTimeout(() => setT(null), 4000);
    return () => clearTimeout(h);
  }, [t]);
  const show = useCallback((msg: string, kind: "ok" | "err" = "ok") => setT({ id: Date.now(), msg, kind }), []);
  const node = t ? <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div> : null;
  return { show, node };
}
