import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import type { TodoItem, RecurrenceType } from "@/types/todo";
import {
  loadTodos,
  insertTodo,
  updateTodo,
  removeTodo,
  clearCompletedTodos as dbClearCompleted,
} from "@/lib/db";

// ──────────────── 类型定义 ────────────────

export interface TodoStoreState {
  todos: TodoItem[];
  /** 最近一次 DB 写入错误信息 */
  lastError: string | null;
  /** 最近一次操作成功提示 */
  lastSuccess: string | null;
}

export interface TodoStoreActions {
  init: () => Promise<void>;
  reloadFromDb: () => Promise<void>;
  addTodo: () => string;
  /** 实时更新文本（仅内存，不写 DB） */
  updateTodoText: (id: string, text: string) => void;
  /** 提交编辑（blur / Enter 时调用）：写 DB */
  commitTodoEdit: (id: string) => void;
  deleteTodo: (id: string) => void;
  clearCompletedTodos: () => void;
  togglePinned: (id: string) => void;
  toggleCompleted: (id: string) => void;
  setTodoColor: (id: string, colorId: TodoItem["colorId"]) => void;
  setTodoDueDate: (id: string, dueDate: number) => void;
  setTodoRecurrence: (
    id: string,
    isRecurring: boolean,
    type: RecurrenceType,
    config: string,
  ) => void;
  /** 直接更新一条 todo（用于自动推进循环时间等场景） */
  updateTodoDirect: (id: string, dueDate: number) => void;
  /** 拖拽排序：将 fromId 移到 toId 的位置 */
  reorderTodos: (fromId: string, toId: string) => void;
  /** 复制待办到指定截止日期（生成新条目，原始不变） */
  duplicateTodo: (id: string, dueDate: number) => void;
  clearError: () => void;
  /** 设置操作成功提示 */
  setSuccess: (msg: string) => void;
  clearSuccess: () => void;
}

function nextOrder(todos: TodoItem[]): number {
  if (todos.length === 0) return 1;
  return Math.max(...todos.map((x) => x.sortOrder)) + 1;
}

// ──────────────── 异步 DB 写（带错误反馈） ────────────────

function dbWrite(
  promise: Promise<unknown>,
  label: string,
  onError: (msg: string) => void,
): void {
  promise
    .then(() => console.log(`[LiteNote] ${label} ✅`))
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[LiteNote] ${label} ❌`, e);
      onError(`${label} 失败: ${msg}`);
    });
}

// ──────────────── Store ────────────────

export const useTodoStore = create<TodoStoreState & TodoStoreActions>()(
  (set, get) => ({
    todos: [],
    lastError: null,
    lastSuccess: null,

    clearError: () => set({ lastError: null }),
    clearSuccess: () => set({ lastSuccess: null }),
    setSuccess: (msg) => set({ lastSuccess: msg }),

    init: async () => {
      const todos = await loadTodos();
      set({ todos });
    },

    reloadFromDb: async () => {
      const todos = await loadTodos();
      set({ todos });
      console.log("[LiteNote] Todos 已从数据库重新加载");
    },

    // ── Todo 操作（乐观更新：同步改 state，异步写 DB） ──

    addTodo: () => {
      const now = Date.now();
      const id = crypto.randomUUID();
      const item: TodoItem = {
        id,
        text: "",
        colorId: "none",
        pinned: false,
        completed: false,
        sortOrder: nextOrder(get().todos),
        createTime: now,
        updateTime: now,
        dueDate: 0,
        reminded: false,
        isRecurring: false,
        recurrenceType: "none",
        recurrenceConfig: "",
      };
      set((s) => ({ todos: [...s.todos, item] }));
      dbWrite(
        insertTodo(item),
        "addTodo",
        (msg) => set({ lastError: msg }),
      );
      return id;
    },

    updateTodoText: (id, text) => {
      set((s) => ({
        todos: s.todos.map((x) =>
          x.id === id ? { ...x, text } : x,
        ),
      }));
    },

    commitTodoEdit: (id) => {
      const item = get().todos.find((x) => x.id === id);
      if (!item) return;
      const updated = { ...item, updateTime: Date.now() };
      dbWrite(
        updateTodo(updated),
        "updateTodo",
        (msg) => set({ lastError: msg }),
      );
    },

    deleteTodo: (id) => {
      set((s) => ({ todos: s.todos.filter((x) => x.id !== id) }));
      dbWrite(
        removeTodo(id),
        "deleteTodo",
        (msg) => set({ lastError: msg }),
      );
    },

    clearCompletedTodos: () => {
      set((s) => ({ todos: s.todos.filter((x) => !x.completed) }));
      dbWrite(
        dbClearCompleted(),
        "clearCompletedTodos",
        (msg) => set({ lastError: msg }),
      );
    },

    togglePinned: (id) => {
      const now = Date.now();
      let updated!: TodoItem;
      set((s) => ({
        todos: s.todos.map((x) =>
          x.id === id
            ? ((updated = { ...x, pinned: !x.pinned, updateTime: now }), updated)
            : x,
        ),
      }));
      if (updated) {
        dbWrite(
          updateTodo(updated),
          "togglePinned",
          (msg) => set({ lastError: msg }),
        );
      }
    },

    toggleCompleted: (id) => {
      const now = Date.now();
      let updated!: TodoItem;
      set((s) => ({
        todos: s.todos.map((x) => {
          if (x.id !== id) return x;
          const nextCompleted = !x.completed;
          return ((updated = {
            ...x,
            completed: nextCompleted,
            pinned: nextCompleted ? false : x.pinned,
            updateTime: now,
          }),
          updated);
        }),
      }));
      if (updated) {
        dbWrite(
          updateTodo(updated),
          "toggleCompleted",
          (msg) => set({ lastError: msg }),
        );
      }
    },

    setTodoColor: (id, colorId) => {
      const now = Date.now();
      let updated!: TodoItem;
      set((s) => ({
        todos: s.todos.map((x) =>
          x.id === id
            ? ((updated = { ...x, colorId, updateTime: now }), updated)
            : x,
        ),
      }));
      if (updated) {
        dbWrite(
          updateTodo(updated),
          "setTodoColor",
          (msg) => set({ lastError: msg }),
        );
      }
    },

    setTodoDueDate: (id, dueDate) => {
      const now = Date.now();
      let updated!: TodoItem;
      set((s) => ({
        todos: s.todos.map((x) =>
          x.id === id
            ? ((updated = {
                ...x,
                dueDate,
                updateTime: now,
                // 重新设置截止时间后，进入新一轮提醒窗口，清空 reminded
                reminded: false,
              }), updated)
            : x,
        ),
      }));
      if (updated) {
        dbWrite(
          updateTodo(updated),
          "setTodoDueDate",
          (msg) => set({ lastError: msg }),
        );
      }
    },

    setTodoRecurrence: (id, isRecurring, type, config) => {
      const now = Date.now();
      let updated!: TodoItem;
      set((s) => ({
        todos: s.todos.map((x) =>
          x.id === id
            ? ((updated = {
                ...x,
                isRecurring,
                recurrenceType: type,
                recurrenceConfig: config,
                // 设为循环时重置 reminded，确保新轮次能提醒
                reminded: isRecurring ? false : x.reminded,
                updateTime: now,
              }),
              updated)
            : x,
        ),
      }));
      if (updated) {
        dbWrite(
          updateTodo(updated),
          "setTodoRecurrence",
          (msg) => set({ lastError: msg }),
        );
      }
    },

    updateTodoDirect: (id, dueDate) => {
      const now = Date.now();
      let updated!: TodoItem;
      set((s) => ({
        todos: s.todos.map((x) =>
          x.id === id
            ? ((updated = {
                ...x,
                dueDate,
                reminded: false,
                updateTime: now,
              }),
              updated)
            : x,
        ),
      }));
      if (updated) {
        dbWrite(
          updateTodo(updated),
          "updateTodoDirect",
          (msg) => set({ lastError: msg }),
        );
      }
    },

    reorderTodos: (fromId, toId) => {
      const { todos } = get();
      // 仅在活跃待办中排序
      const active = todos.filter((x) => !x.completed);
      const completed = todos.filter((x) => x.completed);

      const fromIdx = active.findIndex((x) => x.id === fromId);
      const toIdx = active.findIndex((x) => x.id === toId);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;

      const reordered = [...active];
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved);

      const now = Date.now();
      const updated = [
        ...reordered.map((t, i) => ({
          ...t,
          sortOrder: i + 1,
          updateTime: now,
        })),
        ...completed,
      ];

      set({ todos: updated });

      // 异步写入 DB
      for (const t of updated) {
        dbWrite(
          updateTodo(t),
          "reorderTodos",
          (msg) => set({ lastError: msg }),
        );
      }
    },

    duplicateTodo: (id, dueDate) => {
      const original = get().todos.find((x) => x.id === id);
      if (!original) return;

      const now = Date.now();
      const newId = crypto.randomUUID();
      const copy: TodoItem = {
        id: newId,
        text: original.text,
        colorId: original.colorId,
        pinned: false,
        completed: false,
        sortOrder: original.sortOrder + 0.5,
        createTime: now,
        updateTime: now,
        dueDate,
        reminded: false,
        isRecurring: false,
        recurrenceType: "none",
        recurrenceConfig: "",
      };

      // 插入到原条目后方，重排 sortOrder
      const todos = [...get().todos];
      const idx = todos.findIndex((x) => x.id === id);
      if (idx === -1) return;
      todos.splice(idx + 1, 0, copy);

      const active = todos.filter((x) => !x.completed);
      const completed = todos.filter((x) => x.completed);
      const reordered = [
        ...active.map((t, i) => ({ ...t, sortOrder: i + 1 })),
        ...completed,
      ];
      set({ todos: reordered });

      const dbCopy = reordered.find((x) => x.id === newId);
      if (dbCopy) {
        dbWrite(
          insertTodo(dbCopy),
          "duplicateTodo",
          (msg) => set({ lastError: msg }),
        );
      }
    },
  }),
);

// ──────────────── 跨窗口待办同步 ────────────────

const TODOS_EVENT = "litenote-todos-updated";

let _todosSyncInitDone = false;

/**
 * 注册跨窗口待办同步监听。
 * 当其他窗口（如提醒弹窗）修改了 DB 中的 todo 数据后，
 * 会通过 Tauri 事件通知本窗口重新从数据库加载。
 */
export function initTodosSync(): () => void {
  if (_todosSyncInitDone) return () => {};
  _todosSyncInitDone = true;

  let unlisten: (() => void) | null = null;

  listen<{ ts: number; source?: string }>(TODOS_EVENT, async (event) => {
    // 跳过自身发出的消息
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    if (event.payload.source === getCurrentWindow().label) return;

    console.log("[LiteNote] 收到待办更新事件，重新加载数据");
    await useTodoStore.getState().reloadFromDb();
  }).then((fn) => {
    unlisten = fn;
  });

  return () => {
    if (unlisten) unlisten();
  };
}
