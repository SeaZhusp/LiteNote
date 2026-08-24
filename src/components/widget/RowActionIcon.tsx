import type { ButtonHTMLAttributes, ReactNode } from "react";

type RowActionIconVariant = "neutral" | "danger";

interface RowActionIconProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 图标内容 */
  children: ReactNode;
  /** 危险操作（删除）使用红色强调；中性操作（备注等）使用中性高亮 */
  variant?: RowActionIconVariant;
}

/**
 * 待办行 hover 时才显形（变为 opacity-100）的操作图标按钮。
 * 统一了所有行内 hover 图标的视觉与交互，避免各自内联导致样式不一致。
 * - neutral：中性高亮（白底微透），用于备注/进度等普通操作
 * - danger ：红色强调，用于删除等破坏性操作
 */
export function RowActionIcon({
  children,
  variant = "neutral",
  className = "",
  ...rest
}: RowActionIconProps) {
  const variantCls =
    variant === "danger"
      ? "hover:bg-red-500/15 hover:!text-red-500 focus:bg-red-500/15 focus:!text-red-500"
      : "hover:bg-white/10 focus:bg-white/10";
  return (
    <button
      type="button"
      data-tauri-no-drag
      className={
        "shrink-0 rounded-md p-1 opacity-0 transition-all " +
        "focus:opacity-100 focus:outline-none " +
        "group-hover:opacity-100 " +
        variantCls +
        " " +
        className
      }
      {...rest}
    >
      {children}
    </button>
  );
}
