import { useEffect } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { WidgetShell } from "@/components/widget/WidgetShell";
import { ReminderWindow } from "@/components/window/ReminderWindow";
import { useAppInit } from "@/hooks/useAppInit";
import { startReminderPoll } from "@/lib/reminderPoll";
import { useSettingsStore } from "@/stores/settingsStore";

function App() {
  // 提醒弹窗窗口（?window=reminder）不挂载主应用，主题等不用关心
  const isReminderWindow =
    new URLSearchParams(window.location.search).get("window") === "reminder";

  if (isReminderWindow) {
    return (
      <ErrorBoundary>
        <ReminderWindow />
      </ErrorBoundary>
    );
  }

  return <MainApp />;
}

function MainApp() {
  useAppInit(true);

  const initialized = useSettingsStore((s) => s.initialized);
  const theme = useSettingsStore((s) => s.theme);
  const locked = useSettingsStore((s) => s.locked);

  // 绑定 data-theme 到 html 根节点
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // 锁定状态：给根节点加 ln-locked，由 CSS 关闭窗口拖拽
  useEffect(() => {
    document.documentElement.classList.toggle("ln-locked", locked);
  }, [locked]);

  useEffect(() => {
    if (initialized) {
      startReminderPoll();
    }
  }, [initialized]);

  return (
    <ErrorBoundary>
      <WidgetShell />
    </ErrorBoundary>
  );
}

export default App;
