import { useState, type ReactNode } from "react";

type TooltipPlacement = "top" | "bottom" | "left" | "right";
type TooltipAlign = "start" | "center" | "end";

interface TooltipProps {
  /** tooltip 显示的文本内容（为空时不渲染） */
  content: ReactNode;
  /** 触发元素 */
  children: ReactNode;
  /** 弹出位置，默认在下方 */
  placement?: TooltipPlacement;
  /** 相对触发元素的对齐方式。top/bottom 时控制水平（默认 start = 左对齐，避免长内容左侧被裁），left/right 时控制垂直（默认 center） */
  align?: TooltipAlign;
  /** 触发方式，默认 hover */
  trigger?: "hover" | "manual";
  /** manual 模式下是否显示 */
  open?: boolean;
  className?: string;
}

/**
 * 通用轻量 tooltip：替代浏览器原生 title，样式与主题一致。
 * - 默认 placement=bottom + align=start（左对齐），避免长内容左侧被行边界裁切
 * - hover 触发时，由内部维护显隐状态
 * - 也可传入 trigger="manual" + open 受外部控制（如避免与气泡卡片冲突）
 */
export function Tooltip({
  content,
  children,
  placement = "bottom",
  align = "start",
  trigger = "hover",
  open,
  className = "",
}: TooltipProps) {
  const [hovered, setHovered] = useState(false);
  const visible = trigger === "manual" ? !!open : hovered;
  if (!content) return <>{children}</>;

  const posCls = buildPositionClass(placement, align);

  return (
    <span
      className={"relative inline-flex " + className}
      onMouseEnter={trigger === "hover" ? () => setHovered(true) : undefined}
      onMouseLeave={trigger === "hover" ? () => setHovered(false) : undefined}
    >
      {children}
      {visible ? (
        <span
          role="tooltip"
          data-tauri-no-drag
          className={
            "pointer-events-none absolute z-30 w-max max-w-56 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl " +
            posCls
          }
          style={{
            background: "var(--ln-theme-surface)",
            borderColor: "var(--ln-theme-border)",
            color: "var(--ln-theme-text)",
          }}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}

function buildPositionClass(placement: TooltipPlacement, align: TooltipAlign): string {
  // 主轴偏移（placement 方向）
  if (placement === "top") return `bottom-full mb-1 ${axisX(align)}`;
  if (placement === "bottom") return `top-full mt-1 ${axisX(align)}`;
  if (placement === "left") return `right-full mr-1 ${axisY(align)}`;
  return `left-full ml-1 ${axisY(align)}`;
}

// top/bottom 方向：控制水平对齐
function axisX(align: TooltipAlign): string {
  if (align === "end") return "right-0";
  if (align === "center") return "left-1/2 -translate-x-1/2";
  return "left-0";
}

// left/right 方向：控制垂直对齐
function axisY(align: TooltipAlign): string {
  if (align === "start") return "top-0";
  if (align === "end") return "bottom-0";
  return "top-1/2 -translate-y-1/2";
}
