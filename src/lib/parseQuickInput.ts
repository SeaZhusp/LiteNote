/**
 * 快速输入解析：从待办文本中识别自然语义日期/时间，
 * 返回解析出的截止时间戳以及去除日期片段后的干净文本。
 *
 * 支持的语义（中英文混合均可）：
 *   相对日：今天 / 明天 / 后天 / 大后天 / 前天
 *   周指称：周一~周日 / 星期一~星期日 / 下周X / 下周一 / 周末
 *   绝对日：8月20日 / 8/20 / 8-20
 *   时间：9:00 / 9点 / 9.30 / 下午3点 / 早上9点 / 晚上8点 / 9点30分
 *
 * 设计原则：
 *   - 纯函数、无依赖，便于测试与复用。
 *   - 解析出的日期片段会从文本中移除，让待办正文保持干净，
 *     截止时间由独立的 dueDate 字段呈现。
 *   - 若无法解析出有效时间，返回 dueDate=0 且 cleanText=原文。
 */

const WEEKDAY_MAP_ZH: Record<string, number> = {
  日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6,
};

/** 把某个 Date 的时分设为指定值，返回时间戳 */
function atTime(base: Date, hour: number, minute: number): number {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

/** 今天 0 点 */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 计算 "下一个" 指定星期几的日期（含今天则取今天） */
function nextWeekday(target: number, from: Date = startOfToday()): Date {
  const cur = from.getDay();
  let diff = (target - cur + 7) % 7;
  if (diff === 0) diff = 7; // 默认取下周同一天，避免总是今天
  const d = new Date(from);
  d.setDate(d.getDate() + diff);
  return d;
}

export interface QuickInputParseResult {
  /** 解析出的截止时间戳（毫秒），0 表示未识别到 */
  dueDate: number;
  /** 去除日期/时间片段后的干净文本 */
  cleanText: string;
  /** 是否识别到了日期语义 */
  matched: boolean;
}

/**
 * 解析时间片段，返回一个设置时分的 Date 基准 + 正则片段。
 * 找不到返回 null。
 */
function parseDateTime(raw: string): { dueDate: number; matchedText: string } | null {
  let text = raw;
  let base: Date | null = null;
  let nextWeek = false;

  // —— 1. 日期部分 ——
  // 明天 / 后天 / 大后天 / 前天 / 今天
  const REL_DAY = /(前天|大后天|后天|明天|今天)/;
  // 周指称：下周X / 下周一... / 周一..周日 / 周末
  const WEEK = /(下(?:个)?)?(?:周|星期|礼拜)([一二三四五六日天])/;
  const WEEKEND = /(下(?:个)?)?周末/;
  // 绝对日期：8月20日 / 8月20 / 8/20 / 8-20 / 8.20
  const ABS = /(\d{1,2})\s*[月\.\-\/]\s*(\d{1,2})\s*日?/;

  let m: RegExpMatchArray | null;

  if ((m = text.match(REL_DAY))) {
    const today = startOfToday();
    const word = m[1];
    const base2 = new Date(today);
    if (word === "今天") base2.setDate(base2.getDate() + 0);
    else if (word === "明天") base2.setDate(base2.getDate() + 1);
    else if (word === "后天") base2.setDate(base2.getDate() + 2);
    else if (word === "大后天") base2.setDate(base2.getDate() + 3);
    else if (word === "前天") base2.setDate(base2.getDate() - 2);
    base = base2;
    text = text.replace(m[0], " ");
  } else if ((m = text.match(WEEK))) {
    const wd = WEEKDAY_MAP_ZH[m[2]];
    if (wd === undefined) return null;
    nextWeek = !!m[1];
    const d = nextWeekday(wd);
    if (nextWeek) {
      // 明确说"下周X"，强制下一周
      d.setDate(d.getDate() + 7);
    }
    base = d;
    text = text.replace(m[0], " ");
  } else if ((m = text.match(WEEKEND))) {
    // 周末 = 本周六（若已过则下周）
    const sat = nextWeekday(6);
    base = sat;
    if (m[1]) sat.setDate(sat.getDate() + 7); // 下周末
    text = text.replace(m[0], " ");
  } else if ((m = text.match(ABS))) {
    const month = parseInt(m[1], 10) - 1;
    const day = parseInt(m[2], 10);
    const now = new Date();
    let year = now.getFullYear();
    const candidate = new Date(year, month, day);
    if (candidate.getTime() < startOfToday().getTime()) {
      // 今年已过的日期，顺延到明年
      year += 1;
    }
    base = new Date(year, month, day);
    text = text.replace(m[0], " ");
  }

  if (!base) return null;

  // —— 2. 时间部分（可选） ——
  // 优先级：HH:mm / HH.mm > 时段+点（下午3点等） > 无（默认当天 23:59:59）
  let hour = 23;
  let minute = 59;

  const HM = /(\d{1,2})[:：.](\d{1,2})/;
  const PERIOD = /(凌晨|早上|上午|中午|下午|傍晚|晚上|夜里)?\s*(\d{1,2})\s*(点|时|:：)/;
  const PERIOD_MIN = /(凌晨|早上|上午|中午|下午|傍晚|晚上|夜里)?\s*(\d{1,2})\s*(点|时)\s*(\d{1,2})\s*(分|分钟)?/;

  let tm: RegExpMatchArray | null;
  if ((tm = text.match(PERIOD_MIN))) {
    let h = parseInt(tm[2], 10);
    const min = parseInt(tm[4], 10);
    const period = tm[1];
    h = applyPeriod(h, period);
    hour = h; minute = min;
    text = text.replace(tm[0], " ");
  } else if ((tm = text.match(HM))) {
    hour = parseInt(tm[1], 10);
    minute = parseInt(tm[2], 10);
    text = text.replace(tm[0], " ");
  } else if ((tm = text.match(PERIOD))) {
    let h = parseInt(tm[2], 10);
    const period = tm[1];
    h = applyPeriod(h, period);
    hour = h; minute = 0;
    text = text.replace(tm[0], " ");
  }

  const due = atTime(base, hour, minute);
  return { dueDate: due, matchedText: text };
}

/** 根据中文时段词调整小时（12 小时制转 24 小时制） */
function applyPeriod(hour: number, period?: string): number {
  if (period === "下午" || period === "傍晚" || period === "晚上" || period === "夜里") {
    if (hour < 12) return hour + 12;
    return hour;
  }
  if (period === "中午") {
    return hour === 12 ? 12 : hour;
  }
  // 凌晨/早上/上午：保持 0-11
  if (period === "凌晨" && hour === 12) return 0;
  return hour;
}

/**
 * 解析待办文本中的日期语义。
 * 会尝试所有命中的日期片段，取最后一个（通常最具体）。
 */
export function parseQuickInput(rawText: string): QuickInputParseResult {
  const original = rawText;
  // 先跑一遍中文日期解析
  const zh = parseDateTime(rawText);
  if (zh && zh.dueDate > 0) {
    return {
      dueDate: zh.dueDate,
      cleanText: collapseSpaces(zh.matchedText) || original,
      matched: true,
    };
  }
  return { dueDate: 0, cleanText: original, matched: false };
}

/** 合并多余空格并去除首尾空白 */
function collapseSpaces(s: string): string {
  return s.replace(/\s{2,}/g, " ").replace(/\s+$/g, "").replace(/^\s+/g, "");
}
