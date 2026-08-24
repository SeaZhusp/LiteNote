import { useMemo, useState } from "react";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { Locale } from "@/i18n";
import { t } from "@/i18n";
import { sortTodos, bucketCompletedByTime } from "@/lib/todoSort";
import { FOCUS_MAX_LIST_HEIGHT } from "@/lib/focusWindowSize";
import type { TodoItem } from "@/types/todo";
import { TodoRow } from "./TodoRow";

const emptyCenter =
  "flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-6 text-center text-sm";
const emptyStyle = { color: "var(--ln-theme-text-secondary)" } as React.CSSProperties;

interface TodoListProps {
  locale: Locale;
  todos: TodoItem[];
  selectedId: string | null;
  editingId: string | null;
  emptyHint: string;
  /** 专注模式：仅未完成、只读列表 */
  focusMode?: boolean;
  /** 视图筛选：进行中 / 已完成（由 WidgetShell 的 Segment 控制） */
  todoView?: "active" | "completed";
  /** 周日历选中日期（null 表示不筛选）；已完成视图按 completedTime 落在当天叠加过滤 */
  selectedDate?: number | null;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onChangeText: (id: string, text: string) => void;
  onEndEdit: () => void;
  onToggleCompleted: (id: string) => void;
  /** hover 删除图标点击后请求删除（需二次确认） */
  onRequestDelete: (id: string) => void;
  /** 由右键菜单触发的「备注与进度」气泡待办 id（null 表示无） */
  openNoteForId?: string | null;
  /** 关闭备注气泡时回调（用于清空触发源） */
  onOpenNote?: (id: string) => void;
}

export function TodoList({
  locale,
  todos,
  selectedId,
  editingId,
  emptyHint,
  focusMode = false,
  todoView = "active",
  selectedDate = null,
  onSelect,
  onContextMenu,
  onChangeText,
  onEndEdit,
  onToggleCompleted,
  onRequestDelete,
  openNoteForId = null,
  onOpenNote,
}: TodoListProps) {
  const { activeSorted, completedSorted, activeIds, completedBuckets } = useMemo(() => {
    const active = todos.filter((x) => !x.completed);
    let done = todos.filter((x) => x.completed);
    // completedTime 为空（历史数据）时回退到 updateTime
    const effCt = (x: TodoItem) => (x.completedTime > 0 ? x.completedTime : x.updateTime);
    // 叠加周日历选中日期：已完成视图按完成时间落在当天过滤
    if (selectedDate !== null) {
      const start = new Date(selectedDate);
      start.setHours(0, 0, 0, 0);
      const dayStart = start.getTime();
      const dayEnd = dayStart + 86_399_999;
      done = done.filter(
        (x) => effCt(x) >= dayStart && effCt(x) <= dayEnd,
      );
    }
    return {
      activeSorted: sortTodos(active),
      completedSorted: sortTodos(done),
      activeIds: active.map((x) => x.id),
      completedBuckets: bucketCompletedByTime(done),
    };
  }, [todos, selectedDate]);

  // 已完成视图：分组折叠态（默认全部展开）
  const [collapsedBuckets, setCollapsedBuckets] = useState<
    Record<string, boolean>
  >({});

  const renderRows = (list: TodoItem[]) =>
    list.map((todo) => (
      <TodoRow
        key={todo.id}
        todo={todo}
        locale={locale}
        focusMode={focusMode}
        selected={todo.id === selectedId}
        editing={todo.id === editingId}
        onSelect={() => onSelect(todo.id)}
        onContextMenu={(e) => onContextMenu(e, todo.id)}
        onChangeText={(text) => onChangeText(todo.id, text)}
        onEndEdit={onEndEdit}
        onToggleCompleted={() => onToggleCompleted(todo.id)}
        onRequestDelete={() => onRequestDelete(todo.id)}
        openNoteForId={openNoteForId}
        onOpenNote={onOpenNote}
      />
    ));

  if (focusMode) {
    if (activeSorted.length === 0) {
      return (
        <div
          className={`${emptyCenter} min-h-0 flex-1 whitespace-pre-line`}
          style={emptyStyle}
        >
          {emptyHint}
        </div>
      );
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          style={{ maxHeight: FOCUS_MAX_LIST_HEIGHT }}
        >
          {renderRows(activeSorted)}
        </div>
      </div>
    );
  }

  if (todos.length === 0) {
    return (
      <div className={emptyCenter} style={emptyStyle}>
        {emptyHint}
      </div>
    );
  }

  // 已完成视图：按完成时间互斥分桶渲染
  if (todoView === "completed") {
    const bucketTitles: Record<string, string> = {
      today: t(locale, "completedToday"),
      "3days": t(locale, "completed3Days"),
      "7days": t(locale, "completed7Days"),
      "30days": t(locale, "completed30Days"),
      older: t(locale, "completedOlder"),
    };
    const visibleBuckets = completedBuckets.filter((b) => b.items.length > 0);

    if (visibleBuckets.length === 0) {
      return (
        <div className={emptyCenter} style={emptyStyle}>
          {selectedDate !== null
            ? locale === "zh-CN"
              ? "该日期暂无已完成待办"
              : "No completed tasks for this day"
            : t(locale, "emptyNoCompleted")}
        </div>
      );
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {visibleBuckets.map((bucket) => {
            const collapsed = collapsedBuckets[bucket.id] ?? false;
            return (
              <div key={bucket.id} data-tauri-no-drag>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--ln-theme-surface-hover)]"
                  style={{ color: "var(--ln-theme-text)" }}
                  onClick={() =>
                    setCollapsedBuckets((prev) => ({
                      ...prev,
                      [bucket.id]: !collapsed,
                    }))
                  }
                >
                  <span>
                    {bucketTitles[bucket.id]} ({bucket.items.length})
                  </span>
                  <span
                    className="text-xs"
                    style={{ color: "var(--ln-theme-text-secondary)" }}
                    aria-hidden
                  >
                    {collapsed ? "▶" : "▼"}
                  </span>
                </button>
                {!collapsed ? (
                  <SortableContext
                    items={bucket.items.map((x) => x.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {renderRows(bucket.items)}
                  </SortableContext>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeSorted.length === 0 ? (
          <div className={emptyCenter} style={emptyStyle}>
            {completedSorted.length > 0
              ? t(locale, "emptyNoActive")
              : emptyHint}
          </div>
        ) : (
          <SortableContext
            items={activeIds}
            strategy={verticalListSortingStrategy}
          >
            {renderRows(activeSorted)}
          </SortableContext>
        )}
      </div>
    </div>
  );
}
