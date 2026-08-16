import { useMemo, useState } from "react";
import type { Locale } from "@/i18n";
import { t } from "@/i18n";

interface DatePickerProps {
  locale: Locale;
  open: boolean;
  title: string;
  /** 初始日期时间戳 */
  initialDate?: number;
  /** 是否显示时间选择 */
  showTime?: boolean;
  onConfirm: (ts: number) => void;
  onCancel: () => void;
}

const WEEKDAYS_ZH = ["日", "一", "二", "三", "四", "五", "六"];
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

interface CalendarCell {
  day: number;
  ts: number;
  isCurrentMonth: boolean;
  isToday: boolean;
}

export function DatePicker({
  locale,
  open,
  title,
  initialDate,
  showTime = false,
  onConfirm,
  onCancel,
}: DatePickerProps) {
  const now = new Date();
  const initDate = initialDate ? new Date(initialDate) : now;

  const [viewYear, setViewYear] = useState(initDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initDate.getMonth());
  const [selectedTs, setSelectedTs] = useState<number | null>(
    initialDate ? startOfDay(initialDate) : null,
  );
  const [hours, setHours] = useState(initDate.getHours());
  const [minutes, setMinutes] = useState(initDate.getMinutes());

  const todayStart = startOfDay(Date.now());

  const weekdays = locale === "zh-CN" ? WEEKDAYS_ZH : WEEKDAYS_EN;

  const monthLabel = useMemo(() => {
    if (locale === "zh-CN") return `${viewYear}年${viewMonth + 1}月`;
    return new Date(viewYear, viewMonth).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
    });
  }, [viewYear, viewMonth, locale]);

  const cells = useMemo<CalendarCell[]>(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const prevMonthLastDay = new Date(viewYear, viewMonth, 0).getDate();

    const result: CalendarCell[] = [];

    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = new Date(viewYear, viewMonth - 1, prevMonthLastDay - i);
      d.setHours(0, 0, 0, 0);
      result.push({
        day: d.getDate(),
        ts: d.getTime(),
        isCurrentMonth: false,
        isToday: d.getTime() === todayStart,
      });
    }

    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(viewYear, viewMonth, i);
      d.setHours(0, 0, 0, 0);
      result.push({
        day: i,
        ts: d.getTime(),
        isCurrentMonth: true,
        isToday: d.getTime() === todayStart,
      });
    }

    const remaining = 7 - (result.length % 7);
    if (remaining < 7) {
      for (let i = 1; i <= remaining; i++) {
        const d = new Date(viewYear, viewMonth + 1, i);
        d.setHours(0, 0, 0, 0);
        result.push({
          day: i,
          ts: d.getTime(),
          isCurrentMonth: false,
          isToday: d.getTime() === todayStart,
        });
      }
    }

    return result;
  }, [viewYear, viewMonth, todayStart]);

  if (!open) return null;

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleConfirm = () => {
    const baseTs = selectedTs ?? todayStart;
    if (showTime) {
      const d = new Date(baseTs);
      d.setHours(hours, minutes, 0, 0);
      onConfirm(d.getTime());
    } else {
      onConfirm(baseTs + 86_399_999);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[170] flex items-center justify-center"
      style={{ background: "var(--ln-theme-overlay)" }}
      onClick={onCancel}
    >
      <div
        className="w-[296px] rounded-xl p-4 shadow-2xl"
        style={{
          background: "var(--ln-theme-bg)",
          backdropFilter: "var(--ln-theme-backdrop)",
          WebkitBackdropFilter: "var(--ln-theme-backdrop)",
          border: "1px solid var(--ln-theme-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <h3 className="mb-3 text-sm font-semibold" style={{ color: "var(--ln-theme-text)" }}>
          {title}
        </h3>

        {/* 月份导航 */}
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md transition"
            style={{ color: "var(--ln-theme-text-secondary)" }}
            onClick={prevMonth}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <span className="text-sm font-medium" style={{ color: "var(--ln-theme-text)" }}>
            {monthLabel}
          </span>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md transition"
            style={{ color: "var(--ln-theme-text-secondary)" }}
            onClick={nextMonth}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>

        {/* 星期标题 */}
        <div className="mb-1 grid grid-cols-7">
          {weekdays.map((w) => (
            <div
              key={w}
              className="text-center text-[11px] leading-6"
              style={{ color: "var(--ln-theme-text-muted)" }}
            >
              {w}
            </div>
          ))}
        </div>

        {/* 日历网格 */}
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((cell) => {
            const isSelected = selectedTs !== null && cell.ts === selectedTs;
            return (
              <button
                key={cell.ts}
                type="button"
                onClick={() => setSelectedTs(cell.ts)}
                className="flex aspect-square items-center justify-center rounded-md text-xs transition"
                style={{
                  color: isSelected
                    ? "#fff"
                    : cell.isCurrentMonth
                      ? "var(--ln-theme-text)"
                      : "var(--ln-theme-text-muted)",
                  background: isSelected
                    ? "#0ea5e9"
                    : cell.isToday
                      ? "var(--ln-theme-surface-active)"
                      : "transparent",
                  fontWeight: cell.isToday || isSelected ? 600 : 400,
                }}
              >
                {cell.day}
              </button>
            );
          })}
        </div>

        {/* 时间选择 */}
        {showTime && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs" style={{ color: "var(--ln-theme-text-muted)" }}>
              {locale === "zh-CN" ? "时间" : "Time"}
            </span>
            <input
              type="time"
              value={`${pad(hours)}:${pad(minutes)}`}
              onChange={(e) => {
                const [h, m] = e.target.value.split(":").map(Number);
                if (!isNaN(h)) setHours(h);
                if (!isNaN(m)) setMinutes(m);
              }}
              className="rounded-md border px-2 py-1 text-xs"
              style={{
                borderColor: "var(--ln-theme-border)",
                background: "var(--ln-theme-surface)",
                color: "var(--ln-theme-text)",
                colorScheme: "dark",
              }}
            />
          </div>
        )}

        {/* 确认 / 取消 */}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-sm transition"
            style={{
              background: "var(--ln-theme-surface)",
              color: "var(--ln-theme-text-secondary)",
            }}
            onClick={onCancel}
          >
            {t(locale, "cancel")}
          </button>
          <button
            type="button"
            className="rounded-lg bg-sky-500 px-3 py-1.5 text-sm text-white transition hover:bg-sky-600"
            onClick={handleConfirm}
          >
            {t(locale, "confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
