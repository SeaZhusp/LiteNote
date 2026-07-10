import Database from "@tauri-apps/plugin-sql";
import type { TodoItem } from "@/types/todo";
import type { LocaleMode } from "@/i18n";

const DB_NAME = "sqlite:litenote.db";

/** 单例连接 */
let _db: Database | null = null;
/** 并发初始化互斥 Promise：多个调用方同时访问时复用同一个 Promise */
let _dbInitPromise: Promise<Database> | null = null;

// ──────────────── 设置项默认值（单一真实来源） ────────────────

export type ThemeId = "glass" | "dark" | "light";

/** 所有设置项的默认值，作为唯一真实来源 */
export const DEFAULT_SETTINGS = {
  clockCollapsed: true,
  panelOpacity: 0.88,
  localeMode: "system" as LocaleMode,
  alwaysOnTop: false,
  autoStart: true,
  theme: "glass" as ThemeId,
  reminderMode: "popup" as "popup" | "system",
  focusMode: false,
  fullWindowWidth: 360,
  fullWindowHeight: 620,
  shortcutToggleWindow: "CmdOrCtrl+Shift+L",
  shortcutFocusMode: "CmdOrCtrl+Shift+F",
  shortcutPin: "CmdOrCtrl+Shift+P",
};

/** 设置项的运行时类型（非字面量） */
export interface AppSettings {
  readonly clockCollapsed: boolean;
  readonly panelOpacity: number;
  readonly localeMode: LocaleMode;
  readonly alwaysOnTop: boolean;
  readonly autoStart: boolean;
  readonly theme: ThemeId;
  readonly reminderMode: "popup" | "system";
  readonly focusMode: boolean;
  readonly fullWindowWidth: number;
  readonly fullWindowHeight: number;
  readonly shortcutToggleWindow: string;
  readonly shortcutFocusMode: string;
  readonly shortcutPin: string;
}

export async function getDb(): Promise<Database> {
  if (_db) return _db;
  if (!_dbInitPromise) {
    _dbInitPromise = Database.load(DB_NAME).then(async (db) => {
      console.log("[LiteNote] 数据库连接成功:", DB_NAME);
      await initTables(db);
      _db = db;
      return db;
    }).catch((e) => {
      _dbInitPromise = null; // 重置，允许后续重试
      throw e;
    });
  }
  return _dbInitPromise;
}

/** 是否处于可用状态（非 Tauri 环境等） */
export function isDbAvailable(): boolean {
  return _db !== null;
}

// ──────────────── 表结构初始化（幂等 + 自动补齐缺失列） ────────────────

/**
 * todos 表的期望列定义。
 * 新增字段时追加一项即可，老用户启动时会自动 ALTER TABLE ADD COLUMN 补上。
 */
const EXPECTED_TODO_COLUMNS: Array<{ name: string; def: string }> = [
  { name: "id",           def: "TEXT PRIMARY KEY" },
  { name: "text",         def: "TEXT NOT NULL DEFAULT ''" },
  { name: "color_id",     def: "TEXT NOT NULL DEFAULT 'none'" },
  { name: "pinned",       def: "INTEGER NOT NULL DEFAULT 0" },
  { name: "completed",    def: "INTEGER NOT NULL DEFAULT 0" },
  { name: "sort_order",   def: "INTEGER NOT NULL DEFAULT 0" },
  { name: "create_time",  def: "INTEGER NOT NULL DEFAULT 0" },
  { name: "update_time",  def: "INTEGER NOT NULL DEFAULT 0" },
  { name: "due_date",     def: "INTEGER NOT NULL DEFAULT 0" },
  { name: "reminded",     def: "INTEGER NOT NULL DEFAULT 0" },
  { name: "is_recurring", def: "INTEGER NOT NULL DEFAULT 0" },
  { name: "recurrence_type", def: "TEXT NOT NULL DEFAULT 'none'" },
  { name: "recurrence_config", def: "TEXT NOT NULL DEFAULT ''" },
];

async function initTables(db: Database): Promise<void> {
  // 1. 建表（仅新库生效，老库已存在则跳过）
  await db.execute(`
    CREATE TABLE IF NOT EXISTS todos (
      id          TEXT PRIMARY KEY,
      text        TEXT NOT NULL DEFAULT '',
      color_id    TEXT NOT NULL DEFAULT 'none',
      pinned      INTEGER NOT NULL DEFAULT 0,
      completed   INTEGER NOT NULL DEFAULT 0,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      create_time INTEGER NOT NULL DEFAULT 0,
      update_time INTEGER NOT NULL DEFAULT 0
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // 2. 自动补齐缺失列（老库升级用，不影响已有数据）
  await ensureColumns(db);

  console.log("[LiteNote] 表结构检查完毕");
}

/**
 * 对比期望列与实际列，用 ALTER TABLE ADD COLUMN 补上缺失的列。
 * 已有数据不受影响，新列用 DEFAULT 值填充。
 */
async function ensureColumns(db: Database): Promise<void> {
  const rows = await db.select<Array<{ name: string }>>(
    "PRAGMA table_info(todos)",
  );
  const existing = new Set(rows.map((r) => r.name));

  for (const col of EXPECTED_TODO_COLUMNS) {
    if (!existing.has(col.name)) {
      console.log(`[LiteNote] 补齐缺失列: ${col.name}`);
      await db.execute(
        `ALTER TABLE todos ADD COLUMN ${col.name} ${col.def}`,
      );
    }
  }
}

// ──────────────── Todo CRUD ────────────────

export async function loadTodos(): Promise<TodoItem[]> {
  const db = await getDb();
  const rows = await db.select<
    Array<{
      id: string;
      text: string;
      color_id: string;
      pinned: number;
      completed: number;
      sort_order: number;
      create_time: number;
      update_time: number;
      due_date: number;
      reminded: number;
      is_recurring: number;
      recurrence_type: string;
      recurrence_config: string;
    }>
  >("SELECT * FROM todos ORDER BY sort_order ASC, update_time DESC");
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    colorId: r.color_id as TodoItem["colorId"],
    pinned: !!r.pinned,
    completed: !!r.completed,
    sortOrder: r.sort_order,
    createTime: r.create_time,
    updateTime: r.update_time,
    dueDate: r.due_date ?? 0,
    reminded: !!(r.reminded ?? 0),
    isRecurring: !!(r.is_recurring ?? 0),
    recurrenceType: (r.recurrence_type ?? "none") as TodoItem["recurrenceType"],
    recurrenceConfig: r.recurrence_config ?? "",
  }));
}

export async function insertTodo(item: TodoItem): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO todos (id,text,color_id,pinned,completed,sort_order,create_time,update_time,due_date,reminded,is_recurring,recurrence_type,recurrence_config)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      item.id,
      item.text,
      item.colorId,
      item.pinned ? 1 : 0,
      item.completed ? 1 : 0,
      item.sortOrder,
      item.createTime,
      item.updateTime,
      item.dueDate,
      item.reminded ? 1 : 0,
      item.isRecurring ? 1 : 0,
      item.recurrenceType,
      item.recurrenceConfig,
    ],
  );
}

export async function updateTodo(item: TodoItem): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE todos SET text=$2,color_id=$3,pinned=$4,completed=$5,sort_order=$6,update_time=$7,due_date=$8,reminded=$9,is_recurring=$10,recurrence_type=$11,recurrence_config=$12 WHERE id=$1`,
    [
      item.id,
      item.text,
      item.colorId,
      item.pinned ? 1 : 0,
      item.completed ? 1 : 0,
      item.sortOrder,
      item.updateTime,
      item.dueDate,
      item.reminded ? 1 : 0,
      item.isRecurring ? 1 : 0,
      item.recurrenceType,
      item.recurrenceConfig,
    ],
  );
}

export async function removeTodo(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM todos WHERE id=$1", [id]);
}

export async function clearCompletedTodos(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM todos WHERE completed=1");
}

// ──────────────── Settings CRUD ────────────────

/**
 * 从 DB 加载设置值，缺失字段自动用默认值填充。
 *
 * 标准模式：
 *   DB 有值 → 用 DB 的值
 *   DB 无此 key → 用默认值（不会返回 undefined）
 */
export async function loadSettings(): Promise<AppSettings> {
  const db = await getDb();
  const rows = await db.select<Array<{ key: string; value: string }>>(
    "SELECT * FROM settings",
  );

  // 先用默认值作为基底，再逐个覆盖有值的字段
  const result: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, r.key)) {
      try {
        result[r.key] = JSON.parse(r.value);
      } catch {
        result[r.key] = r.value;
      }
    }
  }
  return result as unknown as AppSettings;
}

export async function saveSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    [key, typeof value === "string" ? value : JSON.stringify(value)],
  );
}
