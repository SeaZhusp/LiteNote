import type { TodoItem } from "@/types/todo";

export function sortTodos(list: TodoItem[]): TodoItem[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    // 已完成的按完成时间倒序；未完成的回退到更新时间倒序
    const at = a.completed ? a.completedTime : a.updateTime;
    const bt = b.completed ? b.completedTime : b.updateTime;
    return bt - at;
  });
}

export type CompletedBucketId =
  | "today"
  | "3days"
  | "7days"
  | "30days"
  | "older";

export interface CompletedBucket {
  id: CompletedBucketId;
  /** 桶内待办（已完成，按完成时间倒序） */
  items: TodoItem[];
}

const DAY = 86_400_000;

/**
 * 按 completedTime 互斥分桶：某条已完成项只会落入“最紧”的桶。
 * 顺序：今天 → 近 3 天 → 近 7 天 → 近 30 天 → 30 天前。
 * completedTime 为空（历史数据）时回退到 updateTime。
 */
function effectiveCompletedTime(todo: TodoItem): number {
  return todo.completedTime > 0 ? todo.completedTime : todo.updateTime;
}

export function bucketCompletedByTime(list: TodoItem[]): CompletedBucket[] {
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayStart = startOfToday.getTime();

  const buckets: Record<CompletedBucketId, TodoItem[]> = {
    today: [],
    "3days": [],
    "7days": [],
    "30days": [],
    older: [],
  };

  for (const todo of list) {
    const ct = effectiveCompletedTime(todo);
    if (ct >= todayStart) {
      buckets.today.push(todo);
    } else if (ct >= now - 3 * DAY) {
      buckets["3days"].push(todo);
    } else if (ct >= now - 7 * DAY) {
      buckets["7days"].push(todo);
    } else if (ct >= now - 30 * DAY) {
      buckets["30days"].push(todo);
    } else {
      buckets.older.push(todo);
    }
  }

  return (
    [
      ["today", buckets.today],
      ["3days", buckets["3days"]],
      ["7days", buckets["7days"]],
      ["30days", buckets["30days"]],
      ["older", buckets.older],
    ] as const
  ).map(([id, items]) => ({
    id,
    items: [...items].sort(
      (a, b) => effectiveCompletedTime(b) - effectiveCompletedTime(a),
    ),
  }));
}
