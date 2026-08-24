import { useState } from "react";
import type { Locale } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import { t } from "@/i18n";
import type { RecurrenceType } from "@/types/todo";

interface RecurrencePickerProps {
  locale: Locale;
  open: boolean;
  recurrenceType: RecurrenceType;
  onConfirm: (type: RecurrenceType, config: string, dueDate: number) => void;
  onCancel: () => void;
}

const WEEKDAYS_ZH = ["日", "一", "二", "三", "四", "五", "六"];
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * 计算初始 dueDate 时间戳
 * - daily: 今天或明天的指定时间（如果今天该时间已过则用明天）
 * - weekly: 下一个选中星期几中离今天最近的一个的指定时间
 * - monthly: 下一个选中日期中离今天最近的一个的指定时间
 */
function computeInitialDueDate(
  type: RecurrenceType,
  hour: number,
  minute: number,
  weekdays?: number[],
  daysOfMonth?: number[],
): number {
  const now = new Date();

  switch (type) {
    case "daily": {
      const target = new Date(now);
      target.setHours(hour, minute, 0, 0);
      if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1);
      }
      return target.getTime();
    }
    case "weekly": {
      const days = (weekdays && weekdays.length > 0 ? weekdays : [now.getDay()])
        .slice()
        .sort((a, b) => a - b);
      const target = new Date(now);
      target.setHours(hour, minute, 0, 0);

      const currentDay = target.getDay();
      // 在当前月（本周）找下一个 >= currentDay 的星期
      const sameDay = days.includes(currentDay);
      if (sameDay && target.getTime() > now.getTime()) {
        return target.getTime();
      }
      const nextDay = days.find((d) => d > currentDay);
      let daysUntil: number;
      if (nextDay !== undefined) {
        daysUntil = nextDay - currentDay;
      } else {
        daysUntil = 7 - currentDay + days[0];
      }
      target.setDate(target.getDate() + daysUntil);
      return target.getTime();
    }
    case "monthly": {
      const days = (daysOfMonth && daysOfMonth.length > 0 ? daysOfMonth : [now.getDate()])
        .slice()
        .sort((a, b) => a - b);

      let y = now.getFullYear();
      let m = now.getMonth();
      const build = (yy: number, mm: number, dom: number) => {
        const maxDay = new Date(yy, mm + 1, 0).getDate();
        return new Date(yy, mm, Math.min(dom, maxDay), hour, minute, 0, 0);
      };

      const currentDay = now.getDate();
      // 1) 当天日期在列表里，且今天该时刻尚未过去 → 今天
      if (days.includes(currentDay)) {
        const target = build(y, m, currentDay);
        if (target.getTime() > now.getTime()) return target.getTime();
      }
      // 2) 当前月还有更大的日期
      const nextDom = days.find((d) => d > currentDay);
      if (nextDom !== undefined) {
        const target = build(y, m, nextDom);
        if (target.getTime() > now.getTime()) return target.getTime();
      }
      // 3) 推到下个月取最小值
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
      return build(y, m, days[0]).getTime();
    }
    default:
      return 0;
  }
}

export function RecurrencePicker({
  locale,
  open,
  recurrenceType,
  onConfirm,
  onCancel,
}: RecurrencePickerProps) {
  const now = new Date();
  const [hour, setHour] = useState(now.getHours());
  const [minute, setMinute] = useState(0);
  const [weekdays, setWeekdays] = useState<number[]>([now.getDay()]);
  const [daysOfMonth, setDaysOfMonth] = useState<number[]>([now.getDate()]);

  if (!open) return null;

  const mk = (key: MessageKey) => t(locale, key);
  const isZh = locale === "zh-CN";
  const wdLabels = isZh ? WEEKDAYS_ZH : WEEKDAYS_EN;

  const toggleWeekday = (d: number) => {
    setWeekdays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b),
    );
  };
  const toggleDayOfMonth = (d: number) => {
    setDaysOfMonth((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b),
    );
  };

  const handleConfirm = () => {
    const dueDate = computeInitialDueDate(
      recurrenceType,
      hour,
      minute,
      recurrenceType === "weekly" ? weekdays : undefined,
      recurrenceType === "monthly" ? daysOfMonth : undefined,
    );

    let config: Record<string, unknown> = { interval: 1 };
    if (recurrenceType === "weekly") {
      config = { interval: 1, days: weekdays };
    } else if (recurrenceType === "monthly") {
      config = { interval: 1, daysOfMonth };
    }

    onConfirm(recurrenceType, JSON.stringify(config), dueDate);
  };

  const btnBase =
    "inline-flex h-8 w-8 items-center justify-center rounded-md border text-sm transition";
  const btnActive =
    `${btnBase} border-sky-400 bg-sky-100 text-sky-700`;
  const btnNormal =
    `${btnBase} border-neutral-300 text-neutral-700 hover:bg-neutral-100`;
  const btnBaseSm =
    "inline-flex h-7 w-full items-center justify-center rounded border text-xs transition";
  const btnActiveSm =
    `${btnBaseSm} border-sky-400 bg-sky-100 text-sky-700`;
  const btnNormalSm =
    `${btnBaseSm} border-neutral-300 text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 disabled:hover:bg-transparent`;

  const hourOptions = Array.from({ length: 24 }, (_, i) => i);
  const minOptions = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

  return (
    <div
      className="fixed inset-0 z-[170] flex items-center justify-center bg-black/30"
      onClick={onCancel}
    >
      <div
        className="mx-4 w-80 max-w-[22rem] rounded-xl border border-neutral-200 bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-sm font-semibold text-neutral-900">
          {mk(`recurTitle${recurrenceType.charAt(0).toUpperCase() + recurrenceType.slice(1)}` as MessageKey)}
        </h3>

        {/* 每周：星期多选 */}
        {recurrenceType === "weekly" ? (
          <div className="mb-3">
            <div className="mb-1.5 text-xs text-neutral-500">{mk("recurPickDay")}</div>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <button
                  key={d}
                  type="button"
                  className={weekdays.includes(d) ? btnActive : btnNormal}
                  onClick={() => toggleWeekday(d)}
                >
                  {wdLabels[d]}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* 每月：日期多选网格 */}
        {recurrenceType === "monthly" ? (
          <div className="mb-3">
            <div className="mb-1.5 flex items-center justify-between text-xs text-neutral-500">
              <span>{mk("recurPickDayOfMonth")}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="text-sky-500 hover:underline"
                  onClick={() => setDaysOfMonth(Array.from({ length: 31 }, (_, i) => i + 1))}
                >
                  {isZh ? "全选" : "All"}
                </button>
                <button
                  type="button"
                  className="text-neutral-400 hover:underline"
                  onClick={() => setDaysOfMonth([])}
                >
                  {isZh ? "清空" : "Clear"}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={daysOfMonth.length === 0}
                  className={daysOfMonth.includes(d) ? btnActiveSm : btnNormalSm}
                  onClick={() => toggleDayOfMonth(d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* 时间选择 */}
        <div className="mb-1">
          <div className="mb-1.5 text-xs text-neutral-500">{mk("recurPickTime")}</div>
          <div className="flex items-center gap-2">
            <select
              value={hour}
              onChange={(e) => setHour(parseInt(e.target.value, 10))}
              className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm text-neutral-900 focus:border-sky-400 focus:outline-none"
            >
              {hourOptions.map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}
                </option>
              ))}
            </select>
            <span className="text-sm text-neutral-500">:</span>
            <select
              value={minute}
              onChange={(e) => setMinute(parseInt(e.target.value, 10))}
              className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm text-neutral-900 focus:border-sky-400 focus:outline-none"
            >
              {minOptions.map((m) => (
                <option key={m} value={m}>
                  {String(m).padStart(2, "0")}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg bg-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-300"
            onClick={onCancel}
          >
            {mk("cancel")}
          </button>
          <button
            type="button"
            disabled={
              (recurrenceType === "weekly" && weekdays.length === 0) ||
              (recurrenceType === "monthly" && daysOfMonth.length === 0)
            }
            className="rounded-lg bg-sky-500 px-3 py-1.5 text-sm text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-sky-500"
            onClick={handleConfirm}
          >
            {mk("confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
