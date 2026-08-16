import { useEffect, useMemo, useRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useSettingsStore } from "@/stores/settingsStore";
import type { Locale } from "@/i18n";
import { t } from "@/i18n";
import { COLOR_DOT_STYLE } from "@/lib/itemColors";
import { formatDueDate } from "@/lib/dueDate";
import { formatRecurrence, computeNextDueDate } from "@/lib/recurrence";
import type { TodoItem } from "@/types/todo";
import { useNow } from "@/hooks/useNow";

interface TodoRowProps {
  todo: TodoItem;
  locale: Locale;
  selected: boolean;
  editing: boolean;
  /** 专注模式：仅展示 + 勾选，无编辑/拖拽/右键 */
  focusMode?: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onChangeText: (text: string) => void;
  onEndEdit: () => void;
  onToggleCompleted: () => void;
  /** hover 行时显示删除图标，点击后请求删除（需二次确认） */
  onRequestDelete: () => void;
}

export function TodoRow(props: TodoRowProps) {
  if (props.focusMode) {
    return (
      <FocusTodoRow
        todo={props.todo}
        locale={props.locale}
        onToggleCompleted={props.onToggleCompleted}
      />
    );
  }
  return <ManagementTodoRow {...props} />;
}

function FocusTodoRow({
  todo,
  locale,
  onToggleCompleted,
}: {
  todo: TodoItem;
  locale: Locale;
  onToggleCompleted: () => void;
}) {
  const accent = COLOR_DOT_STYLE[todo.colorId].background;

  return (
    <div
      data-tauri-no-drag
      className="flex min-h-12 cursor-default items-center gap-1 px-2 sm:px-3"
      style={{ borderBottom: `1px solid var(--ln-theme-border-light)` }}
    >
      {todo.isRecurring ? (
        <button
          type="button"
          data-tauri-no-drag
          aria-label={t(locale, "menuDone")}
          title={locale === "zh-CN" ? "完成本轮循环" : "Complete this cycle"}
          className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-white/50"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCompleted();
          }}
        >
          <span
            className="flex h-[0.875rem] w-[0.875rem] items-center justify-center rounded-full border bg-transparent"
            style={{ borderColor: accent }}
          />
          {/* 循环角标 */}
          <span
            className="pointer-events-none absolute -right-0.5 -top-0.5 text-[0.55rem] leading-none"
            style={{ color: accent }}
          >
            ↻
          </span>
        </button>
      ) : (
        <button
          type="button"
          data-tauri-no-drag
          aria-label={t(locale, "menuDone")}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-white/50"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCompleted();
          }}
        >
          <span
            className="flex h-[0.875rem] w-[0.875rem] items-center justify-center rounded-full border bg-transparent"
            style={{ borderColor: accent }}
          />
        </button>
      )}
      <div className="flex min-w-0 flex-1 flex-col py-2">
        <span
          className="whitespace-pre-wrap text-sm leading-snug"
          style={{ color: "var(--ln-theme-text)" }}
        >
          {todo.text || (locale === "zh-CN" ? "（空）" : "(empty)")}
        </span>
      </div>
    </div>
  );
}

function ManagementTodoRow({
  todo,
  locale,
  selected,
  editing,
  onSelect,
  onContextMenu,
  onChangeText,
  onEndEdit,
  onToggleCompleted,
  onRequestDelete,
}: Omit<TodoRowProps, "focusMode">) {
  const accent = COLOR_DOT_STYLE[todo.colorId].background;
  const theme = useSettingsStore((s) => s.theme);
  const trashColor = theme === "light" ? "#000000" : "#e2e8f0";
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 仅未完成且非编辑态的待办可拖拽
  const sortable = useSortable({
    id: todo.id,
    disabled: todo.completed || editing,
    data: { type: "todo" as const },
  });

  // 每分钟刷新当前时间戳，确保逾期状态能自动更新
  const now = useNow(60_000);

  const dueLabel = useMemo(() => {
    if (todo.dueDate <= 0) return null;

    // 循环待办：如果当前 dueDate 已过期，展示自动推进后的下一次时间
    if (todo.isRecurring && todo.dueDate <= Date.now()) {
      const nextDue = computeNextDueDate(
        todo.dueDate,
        todo.recurrenceType,
        todo.recurrenceConfig,
      );
      if (nextDue > 0) {
        return formatDueDate(nextDue, locale === "en" ? "en" : "zh-CN");
      }
      return null;
    }
    return formatDueDate(todo.dueDate, locale === "en" ? "en" : "zh-CN");
  }, [todo.dueDate, todo.isRecurring, todo.recurrenceType, todo.recurrenceConfig, locale, now]);

  const recurrenceLabel = useMemo(
    () =>
      todo.isRecurring
        ? formatRecurrence(
            todo.recurrenceType,
            todo.recurrenceConfig,
            locale === "en" ? "en" : "zh-CN",
          )
        : null,
    [todo.isRecurring, todo.recurrenceType, todo.recurrenceConfig, locale],
  );

  // 进入编辑态时，光标定位到文本末尾
  useEffect(() => {
    if (editing && textareaRef.current) {
      const el = textareaRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <div
      ref={sortable.setNodeRef}
      {...sortable.attributes}
      {...sortable.listeners}
      data-tauri-no-drag
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e);
      }}
      className={
        "group flex min-h-12 cursor-default items-center gap-1 px-2 touch-none sm:px-3 " +
        (sortable.isDragging ? "opacity-0" : "") +
        (!selected ? " hover:bg-[var(--ln-theme-surface-hover)]" : "")
      }
      style={{
        ...style,
        borderBottom: `1px solid var(--ln-theme-border-light)`,
        background: selected ? "var(--ln-theme-surface-active)" : "transparent",
      }}
    >
      {/* 循环待办：显示可点击的完成按钮（带循环角标） */}
      {todo.isRecurring ? (
        <button
          type="button"
          data-tauri-no-drag
          aria-label={t(locale, "menuDone")}
          title={locale === "zh-CN" ? "完成本轮循环" : "Complete this cycle"}
          className={
            "relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full outline-none transition " +
            "focus-visible:ring-2 focus-visible:ring-white/50"
          }
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCompleted();
          }}
        >
          <span
            className="flex h-[0.875rem] w-[0.875rem] items-center justify-center rounded-full border bg-transparent"
            style={{ borderColor: accent }}
          />
          <span
            className="pointer-events-none absolute -right-0.5 -top-0.5 text-[0.6rem] leading-none"
            style={{ color: accent }}
          >
            ↻
          </span>
        </button>
      ) : (
        <button
          type="button"
          data-tauri-no-drag
          aria-pressed={todo.completed}
          aria-label={todo.completed ? t(locale, "menuUndone") : t(locale, "menuDone")}
          className={
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full outline-none transition " +
            "focus-visible:ring-2 focus-visible:ring-white/50"
          }
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCompleted();
          }}
        >
          <span
            className={
              "flex h-[0.875rem] w-[0.875rem] items-center justify-center rounded-full border text-[0.5rem] font-semibold leading-none " +
              (todo.completed ? "border-transparent text-white" : "bg-transparent")
            }
            style={
              todo.completed
                ? { background: accent, boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.2)" }
                : { borderColor: accent }
            }
          >
            {todo.completed ? "✓" : null}
          </span>
        </button>
      )}
      <button
        type="button"
        data-tauri-no-drag
        className="flex min-w-0 flex-1 items-center py-1 text-left cursor-pointer bg-transparent border-0"
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        {editing ? (
          <textarea
            ref={textareaRef}
            data-tauri-no-drag
            className="min-h-10 w-0 flex-1 resize-none bg-transparent text-sm leading-snug outline-none ring-0"
            style={{ color: "var(--ln-theme-text)" }}
            rows={2}
            value={todo.text}
            onChange={(e) => onChangeText(e.target.value)}
            onBlur={onEndEdit}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                (e.target as HTMLTextAreaElement).blur();
              } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                (e.target as HTMLTextAreaElement).blur();
              } else if (e.key === "Enter" && e.shiftKey) {
                e.stopPropagation(); // 允许默认换行，阻止冒泡到父按钮
              } else if (e.key === " ") {
                e.stopPropagation(); // 允许输入空格，阻止冒泡到父按钮
              }
            }}
          />
        ) : (
          <div className="flex min-w-0 flex-1 flex-col py-0.5">
            <span
              className={
                "whitespace-pre-wrap text-sm leading-snug" +
                (todo.completed && !todo.isRecurring ? " opacity-50 line-through" : "")
              }
              style={{ color: "var(--ln-theme-text)" }}
            >
              {todo.text || (locale === "zh-CN" ? "（空）" : "(empty)")}
            </span>
            {(todo.pinned || dueLabel || recurrenceLabel) ? (
              <div className="mt-0.5 flex items-center gap-1.5">
                {todo.pinned ? (
                  <span className="text-xs" style={{ color: "var(--ln-theme-text-secondary)" }}>
                    ↑ {locale === "zh-CN" ? "置顶" : "Pinned"}
                  </span>
                ) : null}
                {recurrenceLabel ? (
                  <span className="text-xs" style={{ color: "var(--ln-theme-text-secondary)" }}>
                    ↻ {recurrenceLabel}
                  </span>
                ) : null}
                {dueLabel ? (
                  <span className="text-xs"
                    style={{ color: todo.completed ? "var(--ln-theme-text-muted)" : "var(--ln-theme-text-secondary)" }}
                  >
                    {dueLabel}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </button>
      <button
        type="button"
        data-tauri-no-drag
        aria-label={locale === "zh-CN" ? "删除待办" : "Delete todo"}
        title={locale === "zh-CN" ? "删除待办" : "Delete todo"}
        className={
          "shrink-0 rounded-md p-1 opacity-0 " +
          "transition-all hover:bg-red-500/15 hover:!text-red-500 " +
          "focus:opacity-100 focus:outline-none focus:bg-red-500/15 focus:!text-red-500 " +
          "group-hover:opacity-100"
        }
        style={{ color: trashColor }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onRequestDelete();
        }}
      >
        <TrashIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

/** 删除图标（hover 行时显示），颜色由父元素的 text-* 控制（跟随主题深浅） */
function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}
