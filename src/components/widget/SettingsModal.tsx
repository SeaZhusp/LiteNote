import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Locale, LocaleMode } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import { t } from "@/i18n";
import type { ThemeId } from "@/lib/db";
import { useSettingsStore } from "@/stores/settingsStore";

interface SettingsModalProps {
  open: boolean;
  locale: Locale;
  localeMode: LocaleMode;
  onSetLocaleMode: (m: LocaleMode) => void;
  panelOpacity: number;
  onPanelOpacityChange: (v: number) => void;
  clockCollapsed: boolean;
  onSetClockCollapsed: (v: boolean) => void;
  autoStart: boolean;
  onSetAutoStart: (v: boolean) => void;
  theme: ThemeId;
  onSetTheme: (t: ThemeId) => void;
  reminderMode: "popup" | "system";
  onSetReminderMode: (m: "popup" | "system") => void;
  onClose: () => void;
}

/* ──────────── Switch 滑动开关 ──────────── */
function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span style={{ color: "var(--ln-theme-text)" }} className="text-sm">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
        style={{ background: checked ? "#0ea5e9" : "var(--ln-theme-text-muted)" }}
      >
        <span
          className="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
          style={{ transform: checked ? "translateX(20px)" : "translateX(4px)" }}
        />
      </button>
    </label>
  );
}

/* ──────────── CustomSelect 自定义下拉 ──────────── */
function CustomSelect<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (listRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    // 延迟绑定，避免打开时的 click 事件立刻触发关闭
    const id = setTimeout(() => document.addEventListener("click", handler), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("click", handler);
    };
  }, [open]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const curLabel = options.find((o) => o.value === value)?.label ?? "";

  // 计算下拉面板位置
  const getPopStyle = useCallback((): React.CSSProperties => {
    if (!btnRef.current) return {};
    const rect = btnRef.current.getBoundingClientRect();
    return {
      position: "fixed",
      top: rect.bottom + 2,
      left: rect.left,
      width: rect.width,
      zIndex: 60,
    };
  }, []);

  return (
    <div className="flex items-center justify-between gap-2">
      <span style={{ color: "var(--ln-theme-text)" }} className="text-xs shrink-0">
        {label}
      </span>
      <div className="shrink-0 w-[108px]">
        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-1 px-2 py-1 rounded-md text-xs leading-tight"
          style={{
            background: "var(--ln-theme-surface)",
            color: "var(--ln-theme-text)",
            border: `1px solid var(--ln-theme-border)`,
          }}
        >
          <span className="truncate">{curLabel}</span>
          <svg className="h-2.5 w-2.5 shrink-0 opacity-70" viewBox="0 0 12 12" fill="none">
            <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {open &&
          createPortal(
            <div
              ref={listRef}
              style={getPopStyle()}
              className="rounded-md overflow-hidden shadow-xl"
            >
              <div
                style={{
                  background: "var(--ln-theme-bg)",
                  backdropFilter: "var(--ln-theme-backdrop)",
                  border: `1px solid var(--ln-theme-border)`,
                  borderRadius: "inherit",
                }}
              >
                {options.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className="w-full text-left px-2 py-1 text-xs leading-tight transition-colors"
                    style={{
                      color: "var(--ln-theme-text)",
                      background:
                        opt.value === value
                          ? "var(--ln-theme-surface-active)"
                          : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (opt.value !== value)
                        (e.target as HTMLElement).style.background = "var(--ln-theme-surface-hover)";
                    }}
                    onMouseLeave={(e) => {
                      if (opt.value !== value)
                        (e.target as HTMLElement).style.background = "transparent";
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>,
            document.body,
          )}
      </div>
    </div>
  );
}

type SettingsTab = "general" | "shortcuts";

function SettingsTabs({
  tab,
  onTabChange,
  generalLabel,
  shortcutsLabel,
}: {
  tab: SettingsTab;
  onTabChange: (t: SettingsTab) => void;
  generalLabel: string;
  shortcutsLabel: string;
}) {
  const btn = (active: boolean) =>
    `flex flex-1 items-center justify-center rounded px-2 text-[10px] leading-none transition-colors ${
      active ? "font-medium" : "hover:opacity-90"
    }`;

  return (
    <div
      className="mb-3 flex h-7 gap-0.5 rounded-md p-0.5"
      style={{ background: "var(--ln-theme-surface)" }}
      role="tablist"
    >
      <button
        type="button"
        role="tab"
        aria-selected={tab === "general"}
        className={btn(tab === "general")}
        style={{
          color: tab === "general" ? "var(--ln-theme-text)" : "var(--ln-theme-text-secondary)",
          background: tab === "general" ? "var(--ln-theme-surface-active)" : "transparent",
        }}
        onClick={() => onTabChange("general")}
      >
        {generalLabel}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === "shortcuts"}
        className={btn(tab === "shortcuts")}
        style={{
          color: tab === "shortcuts" ? "var(--ln-theme-text)" : "var(--ln-theme-text-secondary)",
          background: tab === "shortcuts" ? "var(--ln-theme-surface-active)" : "transparent",
        }}
        onClick={() => onTabChange("shortcuts")}
      >
        {shortcutsLabel}
      </button>
    </div>
  );
}

/* ──────────── 快捷键编辑 ──────────── */

type ShortcutKey = "shortcutToggleWindow" | "shortcutFocusMode" | "shortcutPin";

/** 判断是否为 macOS */
declare global {
  interface NavigatorUAData {
    platform?: string;
  }

  interface Navigator {
    userAgentData?: NavigatorUAData;
  }
}

function isMac(): boolean {
  return navigator.userAgentData?.platform?.toLowerCase().includes("mac") ?? navigator.userAgent.toLowerCase().includes("mac");
}

/** 将 Tauri 快捷键格式转换为显示格式 */
function formatShortcutForDisplay(shortcut: string): string {
  return shortcut
    .split("+")
    .map((part) => {
      switch (part) {
        case "CmdOrCtrl":
        case "CommandOrControl":
          return isMac() ? "⌘" : "Ctrl";
        case "Control":
          return "Ctrl";
        case "Alt":
          return isMac() ? "⌥" : "Alt";
        case "Shift":
          return isMac() ? "⇧" : "Shift";
        case "Super":
        case "Meta":
        case "Win":
          return isMac() ? "⌘" : "Win";
        default:
          return part;
      }
    })
    .join(isMac() ? "" : " + ");
}

/** 将键盘事件转换为 Tauri 快捷键格式 */
function keyEventToShortcut(e: KeyboardEvent): string | null {
  const key = e.key;

  // 忽略单独的修饰键
  if (["Control", "Alt", "Shift", "Meta"].includes(key)) return null;

  // 至少需要一个修饰键
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) return null;

  const parts: string[] = [];

  if (isMac()) {
    if (e.metaKey) parts.push("CmdOrCtrl");
    if (e.ctrlKey) parts.push("Control");
  } else {
    if (e.ctrlKey) parts.push("CmdOrCtrl");
    if (e.metaKey) parts.push("Super");
  }
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");

  // 主键
  let mainKey: string;
  if (key === " ") mainKey = "Space";
  else if (key.length === 1) mainKey = key.toUpperCase();
  else mainKey = key;

  parts.push(mainKey);
  return parts.join("+");
}

function EditableShortcutRow({
  label,
  shortcutKey,
  notSetText,
  pressKeysText,
  conflictText,
  clearLabel,
}: {
  label: string;
  shortcutKey: ShortcutKey;
  notSetText: string;
  pressKeysText: string;
  conflictText: string;
  clearLabel: string;
}) {
  const value = useSettingsStore((s) => s[shortcutKey]);
  const setShortcut = useSettingsStore((s) => s.setShortcut);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!capturing) return;

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setCapturing(false);
        return;
      }

      if (e.key === "Backspace" || e.key === "Delete") {
        setShortcut(shortcutKey, "");
        setCapturing(false);
        return;
      }

      const shortcut = keyEventToShortcut(e);
      if (shortcut) {
        // 检查与其他快捷键冲突
        const state = useSettingsStore.getState();
        const conflict = (
          ["shortcutToggleWindow", "shortcutFocusMode", "shortcutPin"] as ShortcutKey[]
        ).some((k) => k !== shortcutKey && state[k] === shortcut);
        if (conflict) {
          setError(true);
          window.setTimeout(() => setError(false), 1500);
          return;
        }
        setShortcut(shortcutKey, shortcut);
        setCapturing(false);
      }
    };

    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [capturing, shortcutKey, setShortcut]);

  return (
    <div className="flex items-center justify-between gap-2">
      <span
        className="text-sm whitespace-nowrap overflow-hidden text-ellipsis"
        style={{ color: "var(--ln-theme-text)" }}
        title={label}
      >
        {label}
      </span>
      <div className="flex items-center gap-1 shrink-0">
        {value && !capturing && (
          <button
            type="button"
            onClick={() => setShortcut(shortcutKey, "")}
            className="shrink-0 flex h-5 w-5 items-center justify-center rounded text-xs transition hover:bg-white/10"
            style={{ color: "var(--ln-theme-text-muted)" }}
            title={clearLabel}
          >
            ×
          </button>
        )}
        <button
          type="button"
          onClick={() => { setCapturing(true); setError(false); }}
          className="shrink-0 rounded px-2 py-0.5 text-xs font-mono transition min-w-[72px] text-center"
          style={{
            color: error
              ? "#f87171"
              : capturing
                ? "var(--ln-theme-text-muted)"
                : value
                  ? "var(--ln-theme-text-secondary)"
                  : "var(--ln-theme-text-muted)",
            background: "var(--ln-theme-surface)",
            border: `1px solid ${error ? "#f87171" : capturing ? "#0ea5e9" : "var(--ln-theme-border)"}`,
          }}
        >
          {error
            ? conflictText
            : capturing
              ? pressKeysText
              : value
                ? formatShortcutForDisplay(value)
                : notSetText}
        </button>
      </div>
    </div>
  );
}

export function SettingsModal({
  open,
  locale,
  localeMode,
  onSetLocaleMode,
  panelOpacity,
  onPanelOpacityChange,
  clockCollapsed,
  onSetClockCollapsed,
  autoStart,
  onSetAutoStart,
  theme,
  onSetTheme,
  reminderMode,
  onSetReminderMode,
  onClose,
}: SettingsModalProps) {
  const mk = (key: MessageKey) => t(locale, key);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<SettingsTab>("general");

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (open) setTab("general");
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "var(--ln-theme-overlay)" }}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div
        className="flex w-[320px] max-h-[90vh] flex-col rounded-lg px-5 py-5 shadow-2xl"
        style={{ background: "var(--ln-theme-bg)", backdropFilter: "var(--ln-theme-backdrop)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold" style={{ color: "var(--ln-theme-text)" }}>
            {mk("settings")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-white/10"
            style={{ color: "var(--ln-theme-text-secondary)" }}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <SettingsTabs
          tab={tab}
          onTabChange={setTab}
          generalLabel={mk("settingsTabGeneral")}
          shortcutsLabel={mk("settingsTabShortcuts")}
        />

        <div className="min-h-[300px] overflow-y-auto">
        {tab === "general" ? (
          <>
        {/* 外观 */}
        <section className="mb-5">
          <div className="flex items-center gap-3">
            <span style={{ color: "var(--ln-theme-text)", whiteSpace: "nowrap" }} className="text-sm shrink-0">
              {mk("opacityLabel")}
            </span>
            <input
              type="range"
              min={15}
              max={100}
              value={Math.round(panelOpacity * 100)}
              onChange={(e) => onPanelOpacityChange(Number(e.target.value) / 100)}
              className="flex-1 h-5 rounded-full appearance-none cursor-pointer bg-transparent"
              style={{
                WebkitAppearance: "none",
                appearance: "none" as React.CSSProperties["appearance"],
              }}
            />
            <span className="text-xs w-8 text-right shrink-0" style={{ color: "var(--ln-theme-text-secondary)" }}>
              {Math.round(panelOpacity * 100)}%
            </span>
          </div>
          <style>{`
            input[type="range"]::-webkit-slider-runnable-track {
              height: 4px;
              border-radius: 999px;
              background: var(--ln-theme-text-muted);
            }
            input[type="range"]::-webkit-slider-thumb {
              -webkit-appearance: none;
              width: 14px;
              height: 14px;
              border-radius: 50%;
              background: white;
              margin-top: -5px;
              box-shadow: 0 1px 3px rgba(0,0,0,0.3);
              cursor: pointer;
            }
            input[type="range"]::-moz-range-track {
              height: 4px;
              border-radius: 999px;
              background: var(--ln-theme-text-muted);
            }
            input[type="range"]::-moz-range-thumb {
              width: 14px;
              height: 14px;
              border-radius: 50%;
              background: white;
              border: none;
              box-shadow: 0 1px 3px rgba(0,0,0,0.3);
              cursor: pointer;
            }
          `}</style>
        </section>

        {/* 功能开关 */}
        <section className="mb-5 space-y-4">
          <Switch
            checked={!clockCollapsed}
            onChange={(v) => onSetClockCollapsed(!v)}
            label={mk("showClockSection")}
          />
          <Switch
            checked={autoStart}
            onChange={onSetAutoStart}
            label={mk("autoStart")}
          />
        </section>

        {/* 分隔线 */}
        <div className="mb-3" style={{ borderTop: `1px solid var(--ln-theme-border-light)` }} />

        {/* 提醒方式 */}
        <section className="mb-3">
          <CustomSelect
            label={mk("reminderModeLabel")}
            value={reminderMode}
            onChange={onSetReminderMode}
            options={[
              { value: "popup" as const, label: mk("reminderModePopup") },
              { value: "system" as const, label: mk("reminderModeSystem") },
            ]}
          />
        </section>
        <div className="mb-3" style={{ borderTop: `1px solid var(--ln-theme-border-light)` }} />

        {/* 主题 */}
        <section className="mb-3">
          <CustomSelect
            label={mk("themeLabel")}
            value={theme}
            onChange={onSetTheme}
            options={[
              { value: "glass" as const, label: mk("themeGlass") },
              { value: "dark" as const, label: mk("themeDark") },
              { value: "light" as const, label: mk("themeLight") },
            ]}
          />
        </section>

        {/* 语言 */}
        <section>
          <CustomSelect
            label={mk("language")}
            value={localeMode}
            onChange={onSetLocaleMode}
            options={[
              { value: "system" as const, label: mk("langSystem") },
              { value: "zh-CN" as const, label: mk("langZh") },
              { value: "en" as const, label: mk("langEn") },
            ]}
          />
        </section>
          </>
        ) : (
          <section className="space-y-2.5">
            <EditableShortcutRow
              label={mk("shortcutHideWindow")}
              shortcutKey="shortcutToggleWindow"
              notSetText={mk("shortcutNotSet")}
              pressKeysText={mk("shortcutPressKeys")}
              conflictText={mk("shortcutConflict")}
              clearLabel={mk("shortcutClear")}
            />
            <EditableShortcutRow
              label={mk("shortcutFocusMode")}
              shortcutKey="shortcutFocusMode"
              notSetText={mk("shortcutNotSet")}
              pressKeysText={mk("shortcutPressKeys")}
              conflictText={mk("shortcutConflict")}
              clearLabel={mk("shortcutClear")}
            />
            <EditableShortcutRow
              label={mk("shortcutPin")}
              shortcutKey="shortcutPin"
              notSetText={mk("shortcutNotSet")}
              pressKeysText={mk("shortcutPressKeys")}
              conflictText={mk("shortcutConflict")}
              clearLabel={mk("shortcutClear")}
            />
            <p className="text-xs pt-1" style={{ color: "var(--ln-theme-text-muted)" }}>
              {mk("shortcutHint")}
            </p>
          </section>
        )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
