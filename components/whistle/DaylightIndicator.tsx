"use client";
import { useEffect, useId, useRef, useState } from "react";
import { daylightAt } from "@/lib/daylight";
import type { TimeOfDay } from "@/lib/world";
import { useLanguage } from "./Language";

const choices = { auto: "현재 시간", noon: "한낮", midnight: "한밤중" } as const;

export function DaylightIndicator({ value = "auto", onChange }: { value?: TimeOfDay; onChange: (value: TimeOfDay) => void }) {
  const { t } = useLanguage();
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = window.setInterval(update, 30_000);
    document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); button.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const day = daylightAt(now, value).daylight >= .5;
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const label = `${t("시간대")} · ${t(choices[value])}${value === "auto" ? ` · ${t(day ? "현재 낮" : "현재 밤")} ${time}` : ""}`;
  return <div className="daylight-control" ref={root}>
    <button ref={button} type="button" className="daylight-indicator" aria-label={label}
      aria-expanded={open} aria-controls={id} data-time-of-day={day ? "day" : "night"} data-time-mode={value}
      onClick={() => setOpen(!open)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {day ? <><circle cx="12" cy="12" r="4" fill="currentColor" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" /></>
          : <path fill="currentColor" d="M19.7 15.5A8.3 8.3 0 0 1 8.5 4.3 8.3 8.3 0 1 0 19.7 15.5Z" />}
      </svg>
    </button>
    <div id={id} className="daylight-options" role="group" aria-label={t("시간대")} hidden={!open}>
      {(Object.keys(choices) as TimeOfDay[]).map(mode => <button key={mode} type="button" aria-pressed={value === mode}
        aria-label={t(choices[mode])}
        onClick={() => { if (mode !== value) onChange(mode); setNow(new Date()); setOpen(false); button.current?.focus(); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {mode === "auto" && <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>}
            {mode === "noon" && <><circle cx="12" cy="12" r="4" fill="currentColor" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" /></>}
            {mode === "midnight" && <path fill="currentColor" d="M19.7 15.5A8.3 8.3 0 0 1 8.5 4.3 8.3 8.3 0 1 0 19.7 15.5Z" />}
          </svg>
        </button>)}
    </div>
  </div>;
}
