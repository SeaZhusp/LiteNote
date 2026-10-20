import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { Locale } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import { t } from "@/i18n";
import { Icon } from "@/components/Icon";

interface HeaderBarProps {
  locale: Locale;
  alwaysOnTop: boolean;
  locked: boolean;
  onToggleAlwaysOnTop: () => void;
  onToggleLock: () => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  onHide: () => void;
}

const iconBtn =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-100/50";
const iconStyle = { color: "var(--ln-theme-text)" } as React.CSSProperties;

export function HeaderBar({
  locale,
  alwaysOnTop,
  locked,
  onToggleAlwaysOnTop,
  onToggleLock,
  onOpenSettings,
  onOpenAbout,
  onHide,
}: HeaderBarProps) {
  const mk = (key: MessageKey) => t(locale, key);
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion()
      .then((v) => setVersion(`v${v}`))
      .catch(() => setVersion(""));
  }, []);

  return (
    <header
      className={`flex h-11 shrink-0 select-none items-center px-1 ${locked ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
      style={{ borderBottom: `1px solid var(--ln-theme-header-border)` }}
      data-tauri-drag-region={locked ? undefined : true}
    >
      <div
        className="flex min-h-0 min-w-0 flex-1 items-center gap-1.5 self-stretch pl-2 pr-2"
        data-tauri-drag-region={locked ? undefined : true}
      >
        <span className="truncate text-sm font-semibold leading-none" style={{ color: "var(--ln-theme-text)" }}>
          {mk("appName")}
        </span>
        {version ? (
          <span className="shrink-0 text-xs leading-none" style={{ color: "var(--ln-theme-text-muted)" }}>{version}</span>
        ) : null}
      </div>
      <div
        className="flex cursor-default items-center gap-0.5 pr-1"
        data-tauri-no-drag
      >
        <button
          type="button"
          className={iconBtn}
          style={iconStyle}
          title={mk("helpTitle")}
          onClick={onOpenAbout}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
            <line x1="12" y1="8" x2="12" y2="8.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="12" y1="12" x2="12" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className={iconBtn}
          style={iconStyle}
          title={mk("settings")}
          onClick={onOpenSettings}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M19.4 15a1.85 1.85 0 0 0 .37 2.02l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.85 1.85 0 0 0-2.02-.37 1.85 1.85 0 0 0-1.12 1.69V21a2 2 0 1 1-4 0v-.09a1.85 1.85 0 0 0-1.12-1.69 1.85 1.85 0 0 0-2.02.37l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.85 1.85 0 0 0 .37-2.02 1.85 1.85 0 0 0-1.69-1.12H3a2 2 0 1 1 0-4h.09a1.85 1.85 0 0 0 1.69-1.12 1.85 1.85 0 0 0-.37-2.02l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.85 1.85 0 0 0 2.02.37h.03a1.85 1.85 0 0 0 1.12-1.69V3a2 2 0 1 1 4 0v.09a1.85 1.85 0 0 0 1.12 1.69 1.85 1.85 0 0 0 2.02-.37l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.85 1.85 0 0 0-.37 2.02v.03a1.85 1.85 0 0 0 1.69 1.12H21a2 2 0 1 1 0 4h-.09a1.85 1.85 0 0 0-1.69 1.12Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className={iconBtn}
          style={iconStyle}
          title={alwaysOnTop ? mk("alwaysOnTopCancel") : mk("alwaysOnTop")}
          aria-label={alwaysOnTop ? mk("alwaysOnTopCancel") : mk("alwaysOnTop")}
          aria-pressed={alwaysOnTop}
          onClick={onToggleAlwaysOnTop}
        >
          <Icon name={alwaysOnTop ? "pushpin-fill" : "pushpin-line"} />
        </button>
        <button
          type="button"
          className={iconBtn}
          style={iconStyle}
          title={locked ? mk("unlockWindow") : mk("lockWindow")}
          aria-label={locked ? mk("unlockWindow") : mk("lockWindow")}
          aria-pressed={locked}
          onClick={onToggleLock}
        >
          {locked ? (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="12" cy="15.5" r="1.3" fill="currentColor" />
            </svg>
          ) : (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 11V8a4 4 0 0 1 7.5-1.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="12" cy="15.5" r="1.3" fill="currentColor" />
            </svg>
          )}
        </button>
        <button type="button" className={iconBtn} style={iconStyle} title={mk("hideWindow")} onClick={onHide}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M6 12h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  );
}
