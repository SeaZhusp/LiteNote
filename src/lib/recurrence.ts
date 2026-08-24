import type { RecurrenceConfig, RecurrenceType } from "@/types/todo";

/**
 * 根据当前循环规则，计算下一次到期时间戳。
 * 用于循环待办到达截止时间后自动推进到下一轮。
 *
 * @param currentDueDate 当前截止时间戳（毫秒）
 * @param type 循环类型
 * @param config 循环配置 JSON 字符串
 * @returns 下一次的截止时间戳，如果无法计算则返回 0
 */
export function computeNextDueDate(
  currentDueDate: number,
  type: RecurrenceType,
  config: string,
): number {
  if (!currentDueDate || currentDueDate <= 0 || type === "none") return 0;

  let cfg: RecurrenceConfig;
  try {
    cfg = JSON.parse(config);
  } catch {
    return 0;
  }

  const due = new Date(currentDueDate);
  const interval = Math.max(1, cfg.interval || 1);

  switch (type) {
    case "daily":
      return advanceDaily(due, interval);
    case "weekly":
      return advanceWeekly(due, interval, cfg.days || []);
    case "monthly":
      return advanceMonthly(due, interval, cfg.daysOfMonth || (cfg.dayOfMonth != null ? [cfg.dayOfMonth] : []));
    default:
      return 0;
  }
}

/** 每日：加 interval 天，保留原始时分秒 */
function advanceDaily(from: Date, interval: number): number {
  const next = new Date(from);
  next.setDate(next.getDate() + interval);
  return next.getTime();
}

/** 每周：在 days 列表中找下一个符合条件的星期几 */
function advanceWeekly(from: Date, interval: number, days: number[]): number {
  if (days.length === 0) return advanceDaily(from, interval * 7);

  const currentDay = from.getDay(); // 0=Sun
  const sorted = [...days].sort((a, b) => a - b);

  // 先在当前周内找下一个更大的 day
  let found = sorted.find((d) => d > currentDay);

  if (found !== undefined) {
    // 本周内还有
    const next = new Date(from);
    next.setDate(next.getDate() + (found - currentDay));
    return next.getTime();
  }

  // 跨越到下周（按 interval 计算周数），取最小的 day
  const next = new Date(from);
  // 距离下周第一个指定日的天数 = (7 - currentDay) + sorted[0]
  const daysToNext = (7 - currentDay) + sorted[0] + (interval - 1) * 7;
  next.setDate(next.getDate() + daysToNext);
  return next.getTime();
}

/**
 * 每月（多选日期）：在 daysOfMonth 列表中找下一个 >= 当前日期的日期；
 * 若当前月无更大日期，则跨到下一周期（按 interval 个月）取列表最小值。
 * 注意：本函数只在「当前 dueDate 已过期」时被调用，需正确滚动到下个命中日。
 */
function advanceMonthly(
  from: Date,
  interval: number,
  daysOfMonth: number[],
): number {
  if (daysOfMonth.length === 0) {
    // 未指定日期：退化为加 interval 个月，保留原始日
    return advanceMonthlyFallback(from, interval);
  }

  const sorted = [...daysOfMonth].sort((a, b) => a - b);
  const currentDay = from.getDate();

  // 先在「当前月」找下一个更大的日期
  const nextDayThisMonth = sorted.find((d) => d > currentDay);
  if (nextDayThisMonth !== undefined) {
    const candidate = clampToMonth(from.getFullYear(), from.getMonth(), nextDayThisMonth, from);
    if (candidate.getTime() > from.getTime()) return candidate.getTime();
  }

  // 当前月无更大日期 → 跨到下个周期月，取列表最小值
  const base = new Date(from.getFullYear(), from.getMonth() + interval, 1, from.getHours(), from.getMinutes(), from.getSeconds(), from.getMilliseconds());
  return clampToMonth(base.getFullYear(), base.getMonth(), sorted[0], from).getTime();
}

/** 月末截断：目标日超过当月天数则取最后一天，并保留原始时分秒 */
function clampToMonth(y: number, m: number, day: number, src: Date): Date {
  const maxDay = new Date(y, m + 1, 0).getDate();
  const d = Math.min(Math.max(1, day), maxDay);
  return new Date(y, m, d, src.getHours(), src.getMinutes(), src.getSeconds(), src.getMilliseconds());
}

/** 每月兜底：加 interval 个月，保留原始日（无 daysOfMonth 时使用） */
function advanceMonthlyFallback(from: Date, interval: number): number {
  let y = from.getFullYear();
  let m = from.getMonth() + interval;
  while (m > 11) {
    m -= 12;
    y += 1;
  }
  const maxDay = new Date(y, m + 1, 0).getDate();
  const d = Math.min(from.getDate(), maxDay);
  return new Date(y, m, d, from.getHours(), from.getMinutes(), from.getSeconds(), from.getMilliseconds()).getTime();
}

/**
 * 格式化循环规则为可读文本。
 * 用于 UI 显示。
 */
export function formatRecurrence(
  type: RecurrenceType,
  config: string,
  locale: "zh-CN" | "en",
): string | null {
  if (type === "none" || !config) return null;

  let cfg: RecurrenceConfig;
  try {
    cfg = JSON.parse(config);
  } catch {
    return null;
  }

  const isZh = locale === "zh-CN";

  switch (type) {
    case "daily": {
      const n = cfg.interval || 1;
      if (n === 1) return isZh ? "每天重复" : "Daily";
      return isZh ? `每${n}天重复` : `Every ${n} days`;
    }
    case "weekly": {
      const days = cfg.days || [];
      const interval = cfg.interval || 1;
      const dayNames = isZh
        ? ["日", "一", "二", "三", "四", "五", "六"]
        : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

      if (days.length === 0) {
        const prefix = isZh ? "每周重复" : "Weekly";
        if (interval === 1) return prefix;
        return isZh ? `每${interval}周重复` : `Every ${interval} weeks`;
      }

      const dayStr = days.map((d) => dayNames[d]).join("、");
      if (interval === 1) {
        return isZh ? `每周${dayStr}` : `Every ${dayStr}`;
      }
      return isZh
        ? `每${interval}周${dayStr}`
        : `Every ${interval} weeks on ${dayStr}`;
    }
    case "monthly": {
      const days = cfg.daysOfMonth && cfg.daysOfMonth.length > 0
        ? cfg.daysOfMonth
        : (cfg.dayOfMonth != null ? [cfg.dayOfMonth] : []);
      const interval = cfg.interval || 1;
      const dayStr = days.slice().sort((a, b) => a - b).join(isZh ? "、" : ", ");
      if (interval === 1) {
        return days.length
          ? isZh
            ? `每月${dayStr}号`
            : `Monthly on day ${dayStr}`
          : isZh
            ? "每月重复"
            : "Monthly";
      }
      return days.length
        ? isZh
          ? `每${interval}月${dayStr}号`
          : `Every ${interval} months on day ${dayStr}`
        : isZh
          ? `每${interval}月重复`
          : `Every ${interval} months`;
    }
    default:
      return null;
  }
}
