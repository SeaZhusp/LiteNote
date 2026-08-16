import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { TodoItem } from "@/types/todo";
import type { Locale } from "@/i18n";

/**
 * 格式化时间戳为 YYYY-MM-DD HH:mm
 */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 生成待办导出文本内容。
 * 未完成区段：内容 + 截止时间（如有）
 * 已完成区段：内容 + 完成时间
 */
export function generateExportContent(
  todos: TodoItem[],
  locale: Locale,
): string {
  const isZh = locale === "zh-CN";

  // 未完成（pinned 优先，再按 sortOrder 排序）
  const active = todos
    .filter((t) => !t.completed)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return a.sortOrder - b.sortOrder;
    });

  // 已完成（按完成时间倒序）
  const completed = todos
    .filter((t) => t.completed)
    .sort((a, b) => b.completedTime - a.completedTime);

  const contentLabel = isZh ? "内容" : "Content";
  const dueDateLabel = isZh ? "截止时间" : "Due date";
  const completedTimeLabel = isZh ? "完成时间" : "Completed time";
  const sectionUncompleted = isZh ? "【未完成待办】" : "[Uncompleted]";
  const sectionCompleted = isZh ? "【已完成待办】" : "[Completed]";

  const lines: string[] = [];

  // 未完成区段
  if (active.length > 0) {
    lines.push(sectionUncompleted);
    lines.push("");
    for (const todo of active) {
      lines.push(`${contentLabel}：${todo.text || (isZh ? "（空）" : "(empty)")}`);
      if (todo.dueDate > 0) {
        lines.push(`${dueDateLabel}：${formatTime(todo.dueDate)}`);
      }
      lines.push("");
    }
  }

  // 已完成区段
  if (completed.length > 0) {
    lines.push(sectionCompleted);
    lines.push("");
    for (const todo of completed) {
      lines.push(`${contentLabel}：${todo.text || (isZh ? "（空）" : "(empty)")}`);
      lines.push(`${completedTimeLabel}：${formatTime(todo.completedTime)}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * 弹出系统「另存为」对话框，将内容写入用户选定的 txt 文件
 */
export async function saveTxt(content: string): Promise<void> {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const defaultName = `LiteNote_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.txt`;

  const filePath = await save({
    defaultPath: defaultName,
    filters: [{ name: "Text", extensions: ["txt"] }],
  });

  if (!filePath) return; // 用户取消

  await writeTextFile(filePath, content);
}
