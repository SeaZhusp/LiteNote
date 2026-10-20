import { useSettingsStore } from "@/stores/settingsStore";

/** 专注模式顶部拖拽条：窗口高度贴内容时仍保留可拖区域 */
export function FocusDragHandle() {
  const locked = useSettingsStore((s) => s.locked);
  return (
    <div
      className={`flex h-4 shrink-0 items-center justify-center ${locked ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
      data-tauri-drag-region={locked ? undefined : true}
      aria-hidden
    >
      <span
        className="h-1 w-8 rounded-full"
        style={{ background: "var(--ln-theme-text-muted)", opacity: 0.45 }}
      />
    </div>
  );
}
