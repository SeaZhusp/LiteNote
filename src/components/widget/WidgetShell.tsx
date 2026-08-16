import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { resolveLocale, t } from "@/i18n";
import { AboutModal } from "./AboutModal";
import { useWidgetActions } from "@/hooks/useWidgetActions";
import { useFocusWindowSize } from "@/hooks/useFocusWindowSize";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTodoStore } from "@/stores/todoStore";
import type { TodoColorId } from "@/types/todo";
import { generateExportContent, saveTxt } from "@/lib/exportTodos";
import { ClockSection } from "./ClockSection";
import { ConfirmDialog } from "./ConfirmDialog";
import { DatePicker } from "./DatePicker";
import { FooterBar } from "./FooterBar";
import { HeaderBar } from "./HeaderBar";
import { RecurrencePicker } from "./RecurrencePicker";
import { SettingsModal } from "./SettingsModal";
import { TodoContextMenu } from "./TodoContextMenu";
import { TodoList } from "./TodoList";
import { WeekCalendar } from "./WeekCalendar";
import { FocusDragHandle } from "./FocusDragHandle";

/** 获取指定时间戳当天的开始时间（00:00:00） */
function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 获取指定时间戳当天的结束时间（23:59:59.999） */
function endOfDay(ts: number): number {
  return startOfDay(ts) + 86_399_999;
}

export function WidgetShell() {
  const alwaysOnTop = useSettingsStore((s) => s.alwaysOnTop);
  const setAlwaysOnTop = useSettingsStore((s) => s.setAlwaysOnTop);
  const panelOpacity = useSettingsStore((s) => s.panelOpacity);
  const setPanelOpacity = useSettingsStore((s) => s.setPanelOpacity);
  const localeMode = useSettingsStore((s) => s.localeMode);
  const setLocaleMode = useSettingsStore((s) => s.setLocaleMode);
  const clockCollapsed = useSettingsStore((s) => s.clockCollapsed);
  const setClockCollapsed = useSettingsStore((s) => s.setClockCollapsed);
  const weekCalendarCollapsed = useSettingsStore((s) => s.weekCalendarCollapsed);
  const setWeekCalendarCollapsed = useSettingsStore((s) => s.setWeekCalendarCollapsed);
  const autoStart = useSettingsStore((s) => s.autoStart);
  const setAutoStart = useSettingsStore((s) => s.setAutoStart);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const reminderMode = useSettingsStore((s) => s.reminderMode);
  const setReminderMode = useSettingsStore((s) => s.setReminderMode);
  const focusMode = useSettingsStore((s) => s.focusMode);
  const settingsInitialized = useSettingsStore((s) => s.initialized);
  const lastSettingsError = useSettingsStore((s) => s.lastError);
  const clearSettingsError = useSettingsStore((s) => s.clearError);
  const lastTodoError = useTodoStore((s) => s.lastError);
  const clearTodoError = useTodoStore((s) => s.clearError);
  const lastTodoSuccess = useTodoStore((s) => s.lastSuccess);
  const clearTodoSuccess = useTodoStore((s) => s.clearSuccess);
  const setTodoSuccess = useTodoStore((s) => s.setSuccess);
  const reloadFromDb = useTodoStore((s) => s.reloadFromDb);

  // 周日历选中日期（null 表示不筛选）
  const [selectedDate, setSelectedDate] = useState<number | null>(null);
  // 待办视图筛选：进行中 / 已完成
  const [todoView, setTodoView] = useState<"active" | "completed">("active");
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);

  // 直接获取 setTodoDueDate（拖拽到日历日期时需用）
  const setTodoDueDate = useTodoStore((s) => s.setTodoDueDate);

  const lastError = lastSettingsError || lastTodoError;

  // 错误展示（自动清除）
  useEffect(() => {
    if (lastSettingsError) {
      const id = window.setTimeout(() => clearSettingsError(), 4000);
      return () => window.clearTimeout(id);
    }
  }, [lastSettingsError, clearSettingsError]);

  useEffect(() => {
    if (lastTodoError) {
      const id = window.setTimeout(() => clearTodoError(), 4000);
      return () => window.clearTimeout(id);
    }
  }, [lastTodoError, clearTodoError]);

  useEffect(() => {
    if (lastTodoSuccess) {
      const id = window.setTimeout(() => clearTodoSuccess(), 2500);
      return () => window.clearTimeout(id);
    }
  }, [lastTodoSuccess, clearTodoSuccess]);

  const locale = useMemo(() => resolveLocale(localeMode), [localeMode]);

  const noop = useCallback(() => {}, []);
  const noopContextMenu = useCallback((_e: React.MouseEvent, _id: string) => {}, []);
  const noopChangeText = useCallback((_id: string, _text: string) => {}, []);

  // 背景层样式：包含透明度和实际背景
  const bgLayerStyle: React.CSSProperties = useMemo(
    () => ({
      opacity: panelOpacity,
      background: "var(--ln-theme-bg)",
      backdropFilter: "var(--ln-theme-backdrop)",
      WebkitBackdropFilter: "var(--ln-theme-backdrop)",
    }),
    [panelOpacity],
  );

  const {
    todos,
    completedCount,
    menuTodo,
    selectedId,
    editingId,
    menu,
    confirmClear,
    confirmDeleteId,
    dueDatePickerFor,
    recurrencePicker,
    copyToPickerFor,
    setMenu,
    setConfirmClear,
    setConfirmDeleteId,
    handleAdd,
    handleSelect,
    handleContextMenu,
    handleEndEdit,
    handleClearCompleted,
    handleDeleteOne,
    handleDueDateConfirm,
    handleDueDateCancel,
    handleRecurrenceConfirm,
    handleRecurrenceCancel,
    handleCopyToConfirm,
    handleCopyToCancel,
    updateTodoText,
    toggleCompleted,
    reorderTodos,
    menuActions,
  } = useWidgetActions(locale);

  const focusActiveTodos = useMemo(
    () => todos.filter((t) => !t.completed),
    [todos],
  );

  useFocusWindowSize(focusMode, focusActiveTodos.length, settingsInitialized);

  // 进入专注模式时关闭编辑态与右键菜单
  useEffect(() => {
    if (!focusMode) return;
    setMenu(null);
    handleEndEdit();
  }, [focusMode, setMenu, handleEndEdit]);

  // 当前拖拽中的待办 id（用于 DragOverlay）
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const activeDragTodo = useMemo(
    () => (activeDragId ? todos.find((t) => t.id === activeDragId) ?? null : null),
    [activeDragId, todos],
  );

  // 根据周日历选中日期过滤待办
  const filteredTodos = useMemo(() => {
    if (selectedDate === null) return todos;
    return todos.filter((t) => {
      if (t.dueDate <= 0) return false;
      return t.dueDate >= selectedDate && t.dueDate <= endOfDay(selectedDate);
    });
  }, [todos, selectedDate]);

  useEffect(() => {
    document.documentElement.lang = locale === "zh-CN" ? "zh-CN" : "en";
  }, [locale]);

  // 从云端恢复待办后，刷新主列表
  useEffect(() => {
    const handler = () => {
      void reloadFromDb();
      setTodoSuccess(t(locale, "syncStatusOk"));
    };
    window.addEventListener("litenote-webdav-restored", handler);
    return () => window.removeEventListener("litenote-webdav-restored", handler);
  }, [reloadFromDb, setTodoSuccess, locale]);

  useEffect(() => {
    void (async () => {
      try {
        await getCurrentWindow().setAlwaysOnTop(alwaysOnTop);
      } catch {
        /* 浏览器预览 */
      }
    })();
  }, [alwaysOnTop]);

  const handleHide = useCallback(async () => {
    try {
      // 通过 Rust 命令隐藏：先保存窗口状态再隐藏
      await invoke("hide_main_window");
    } catch {
      /* 非 Tauri */
    }
  }, []);

  // 添加待办时，若当前选中了日期则自动附上截止时间（当天 23:59:59）
  const handleAddWithDate = useCallback(() => {
    handleAdd(selectedDate !== null ? endOfDay(selectedDate) : undefined);
  }, [handleAdd, selectedDate]);

  // 导出待办
  const handleExport = useCallback(() => {
    const content = generateExportContent(todos, locale);
    void saveTxt(content).then(() => {
      setTodoSuccess(t(locale, "toastExportSuccess"));
    });
  }, [todos, locale, setTodoSuccess]);

  // 拖拽传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // 拖拽开始：记录被拖的待办
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  }, []);

  // 统一拖拽结束处理：排序 or 设置截止日期（循环待办不允许拖到日历改日期）
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveDragId(null);

      if (!over) return;

      const activeId = String(active.id);
      const overId = String(over.id);

      const overData = over.data.current as { type?: string; date?: number } | undefined;

      if (overData?.type === "day" && overData.date) {
        // 循环待办不允许拖到日历修改日期
        const todo = todos.find((t) => t.id === activeId);
        if (!todo?.isRecurring) {
          setTodoDueDate(activeId, endOfDay(overData.date));
          setSelectedDate(overData.date);
        }
      } else if (activeId !== overId) {
        reorderTodos(activeId, overId);
      }
    },
    [setTodoDueDate, reorderTodos, todos],
  );

  return (
    <>
      {/* Toast 提示（底部居中，错误优先） */}
      {(lastError || lastTodoSuccess) ? (
        <div
          className={`absolute bottom-16 left-1/2 z-[200] -translate-x-1/2 rounded-full bg-black/50 px-4 py-1.5 text-xs backdrop-blur-md shadow-lg ${
            lastError ? "text-red-300" : "text-emerald-300"
          }`}
        >
          {lastError ?? lastTodoSuccess}
        </div>
      ) : null}

      {focusMode ? (
        <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden">
          {/* 透明背景层 */}
          <div
            className="pointer-events-none absolute inset-0 z-0"
            style={bgLayerStyle}
          />
          {/* 内容层 - 文字永远清晰可见 */}
          <div className="relative z-10 flex h-full min-h-0 w-full flex-col">
            <FocusDragHandle />
            <TodoList
              focusMode
              locale={locale}
              todos={focusActiveTodos}
              selectedId={null}
              editingId={null}
              emptyHint={`${t(locale, "focusEmptyHint")}\n${t(locale, "focusModeHint")}`}
              onSelect={noop}
              onContextMenu={noopContextMenu}
              onChangeText={noopChangeText}
              onEndEdit={noop}
              onToggleCompleted={toggleCompleted}
            />
          </div>
        </div>
      ) : (
      <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden">
        {/* 透明背景层 */}
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={bgLayerStyle}
        />
        {/* 内容层 - 文字永远清晰可见 */}
        <div className="relative z-10 flex h-full min-h-0 w-full flex-col">
        <HeaderBar
          locale={locale}
          alwaysOnTop={alwaysOnTop}
          onToggleAlwaysOnTop={() => setAlwaysOnTop(!alwaysOnTop)}
          onOpenAbout={() => setShowAbout(true)}
          onOpenSettings={() => setShowSettings(true)}
          onHide={handleHide}
        />

        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {!clockCollapsed ? <ClockSection locale={locale} /> : null}

          {!weekCalendarCollapsed ? (
            <WeekCalendar
              locale={locale}
              todos={todos}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
            />
          ) : null}

          <div
            className="relative flex items-stretch select-none"
            style={{ borderBottom: "1px solid var(--ln-theme-border)" }}
          >
            {(["active", "completed"] as const).map((view) => {
              const active = todoView === view;
              return (
                <button
                  key={view}
                  type="button"
                  onClick={() => setTodoView(view)}
                  className="flex-1 px-2 py-0.5 text-[9px] font-normal transition-colors"
                  style={{
                    color: active
                      ? "var(--ln-theme-text)"
                      : "var(--ln-theme-text-secondary)",
                    borderBottom: active
                      ? "2px solid var(--ln-theme-accent)"
                      : "2px solid transparent",
                    marginBottom: "-1px",
                  }}
                >
                  {t(locale, view === "active" ? "viewActive" : "viewCompleted")}
                </button>
              );
            })}
          </div>

          <TodoList
            locale={locale}
            todos={filteredTodos}
            todoView={todoView}
            selectedId={selectedId}
            editingId={editingId}
            emptyHint={
              selectedDate !== null
                ? locale === "zh-CN"
                  ? "该日期暂无待办"
                  : "No tasks for this day"
                : t(locale, "emptyHint")
            }
            onSelect={handleSelect}
            onContextMenu={handleContextMenu}
            onChangeText={updateTodoText}
            onEndEdit={handleEndEdit}
            onToggleCompleted={toggleCompleted}
          />

          {/* 拖拽预览：显示待办内容 */}
          <DragOverlay dropAnimation={null}>
            {activeDragTodo ? (
              <div className="rounded-lg bg-white/15 backdrop-blur-md px-3 py-2 text-sm text-white shadow-lg ring-1 ring-white/20 max-w-[200px] truncate">
                {activeDragTodo.text || (locale === "zh-CN" ? "（空）" : "(empty)")}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        <FooterBar
          locale={locale}
          clearCompletedDisabled={completedCount === 0}
          onAdd={handleAddWithDate}
          onExport={handleExport}
          onClearClick={() => setConfirmClear(true)}
          opacity={panelOpacity}
        />

        {/* 设置模态框 */}
        <SettingsModal
          open={showSettings}
          locale={locale}
          localeMode={localeMode}
          onSetLocaleMode={setLocaleMode}
          panelOpacity={panelOpacity}
          onPanelOpacityChange={setPanelOpacity}
          clockCollapsed={clockCollapsed}
          onSetClockCollapsed={setClockCollapsed}
          weekCalendarCollapsed={weekCalendarCollapsed}
          onSetWeekCalendarCollapsed={setWeekCalendarCollapsed}
          autoStart={autoStart}
          onSetAutoStart={setAutoStart}
          theme={theme}
          onSetTheme={setTheme}
          reminderMode={reminderMode}
          onSetReminderMode={setReminderMode}
          onClose={() => setShowSettings(false)}
        />

        {/* 关于模态框 */}
        <AboutModal
          open={showAbout}
          locale={locale}
          onClose={() => setShowAbout(false)}
        />
        </div>
        </div>
      )}

      {!focusMode && menu && menuTodo ? (
        <TodoContextMenu
          locale={locale}
          x={menu.x}
          y={menu.y}
          completed={menuTodo.completed}
          pinned={menuTodo.pinned}
          dueDate={menuTodo.dueDate}
          isRecurring={menuTodo.isRecurring}
          onClose={() => setMenu(null)}
          onPin={menuActions.onPin}
          onDelete={menuActions.onDelete}
          onToggleDone={menuActions.onToggleDone}
          onPickColor={(c: TodoColorId) => menuActions.onPickColor(c)}
          onPickDueDate={menuActions.onPickDueDate}
          onOpenCustomDueDate={menuActions.onOpenCustomDueDate}
          onClearDueDate={menuActions.onClearDueDate}
          onSetRecurrence={menuActions.onSetRecurrence}
          onClearRecurrence={menuActions.onClearRecurrence}
          onCopyTo={menuActions.onCopyTo}
        />
      ) : null}

      {!focusMode ? (
      <>
      <DatePicker
        locale={locale}
        open={dueDatePickerFor !== null}
        title={t(locale, "duePickerTitle")}
        showTime
        onConfirm={handleDueDateConfirm}
        onCancel={handleDueDateCancel}
      />

      <DatePicker
        locale={locale}
        open={copyToPickerFor !== null}
        title={t(locale, "copyToTitle")}
        showTime={false}
        onConfirm={handleCopyToConfirm}
        onCancel={handleCopyToCancel}
      />

      <RecurrencePicker
        locale={locale}
        open={recurrencePicker !== null}
        recurrenceType={recurrencePicker?.type ?? "none"}
        onConfirm={handleRecurrenceConfirm}
        onCancel={handleRecurrenceCancel}
      />

      <ConfirmDialog
        open={confirmClear}
        title={t(locale, "clearCompleted")}
        message={t(locale, "clearCompletedConfirm")}
        confirmLabel={t(locale, "confirm")}
        cancelLabel={t(locale, "cancel")}
        onCancel={() => setConfirmClear(false)}
        onConfirm={handleClearCompleted}
      />

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title={t(locale, "menuDelete")}
        message={t(locale, "deleteOneConfirm")}
        confirmLabel={t(locale, "confirm")}
        cancelLabel={t(locale, "cancel")}
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={handleDeleteOne}
      />
      </>
      ) : null}
    </>
  );
}
