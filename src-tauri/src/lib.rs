use std::path::Path;
use std::time::Duration;

use chrono::{Datelike, TimeDelta, Timelike, Months, NaiveDate, DateTime};
use rusqlite::Connection;
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalPosition, Manager, Runtime, WebviewUrl,
    WebviewWindowBuilder,
};
#[cfg(target_os = "macos")]
use tauri::{ActivationPolicy, RunEvent, TitleBarStyle};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

mod webdav;

/// 背景提醒轮询间隔
const REMINDER_POLL_INTERVAL_SECS: u64 = 30;

/// 持久化窗口位置/大小（不含可见性，避免上次隐藏后被恢复成隐藏态导致「启动打不开」）
fn window_persist_flags() -> StateFlags {
    StateFlags::SIZE | StateFlags::POSITION
}

pub(crate) const SETTINGS_UPDATED_EVENT: &str = "litenote-settings-updated";

/// 循环待办：根据当前截止时间和规则计算下一次截止时间戳
fn compute_next_due(current_due_ms: i64, recurrence_type: &str, config: &str) -> Option<i64> {
    use std::collections::HashMap;

    if current_due_ms <= 0 || recurrence_type == "none" {
        return None;
    }

    let cfg: HashMap<String, serde_json::Value> = serde_json::from_str(config).ok()?;
    let interval = cfg.get("interval").and_then(|v| v.as_i64()).unwrap_or(1).max(1);

    // 毫秒 → NaiveDateTime（注意：前端存储的 due_date 是「本地时间」毫秒戳，
    // 必须用 naive_local() 解析，才能与前端 computeNextDueDate 的 new Date(ms) 保持一致。
    // 若用 naive_utc() 会把本地时间误当 UTC，导致每月/每日的 day/hour 整体偏移。）
    let dt = match DateTime::from_timestamp(current_due_ms / 1000, 0) {
        Some(dt) => dt.naive_local(),
        None => return None,
    };

    let next_dt = match recurrence_type {
        "daily" => {
            dt + TimeDelta::days(interval)
        }
        "weekly" => {
            let days: Vec<i64> = cfg.get("days")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|x| x.as_i64()).collect())
                .unwrap_or_default();

            if days.is_empty() {
                dt + TimeDelta::weeks(interval as i64)
            } else {
                let current_wday = dt.weekday().num_days_from_sunday() as i64;
                let mut sorted = days.clone();
                sorted.sort();

                let next_day = sorted.iter().find(|&&d| d > current_wday);
                let offset_days = match next_day {
                    Some(&nd) => nd - current_wday,
                    None => {
                        let weeks_offset = (interval - 1) * 7;
                        (7 - current_wday) + sorted[0] + weeks_offset
                    }
                };
                dt + TimeDelta::days(offset_days)
            }
        }
        "monthly" => {
            // 多选日期：优先 daysOfMonth，回退 dayOfMonth
            let mut days: Vec<i64> = if let Some(arr) = cfg.get("daysOfMonth").and_then(|v| v.as_array()) {
                arr.iter().filter_map(|x| x.as_i64()).collect()
            } else if let Some(d) = cfg.get("dayOfMonth").and_then(|v| v.as_i64()) {
                vec![d]
            } else {
                vec![dt.day() as i64]
            };
            days.sort_unstable();
            days.dedup();

            let current_day = dt.day() as i64;
            // 先在「当前月」找下一个更大的日期
            if let Some(&nd) = days.iter().find(|&&d| d > current_day) {
                let max_day = dt.date().num_days_in_month() as i64;
                let target_day = nd.min(max_day).max(1);
                let target_date = NaiveDate::from_ymd_opt(dt.year(), dt.month(), target_day as u32)?;
                let candidate = target_date.and_hms_opt(dt.hour(), dt.minute(), dt.second())?;
                if candidate > dt {
                    candidate
                } else {
                    // 退化：跨月处理
                    monthly_next(dt, interval, &days)?
                }
            } else {
                monthly_next(dt, interval, &days)?
            }
        }
        _ => return None,
    };

    Some(next_dt.and_utc().timestamp_millis())
}

/// 每月多选：当前月已无更大日期时，跨 interval 个月取列表最小值
fn monthly_next(dt: chrono::NaiveDateTime, interval: i64, days: &[i64]) -> Option<chrono::NaiveDateTime> {
    let mut y = dt.year();
    let mut m = dt.month() as i32 + interval as i32;
    while m > 12 {
        m -= 12;
        y += 1;
    }
    let max_day = NaiveDate::from_ymd_opt(y, m as u32, 1)
        .and_then(|d| d.checked_add_months(Months::new(1)))
        .and_then(|d| d.pred_opt())
        .map(|d| d.day())
        .unwrap_or(31);
    let target_day = (days[0] as u32).min(max_day).max(1);
    let target_date = NaiveDate::from_ymd_opt(y, m as u32, target_day)?;
    target_date.and_hms_opt(dt.hour(), dt.minute(), dt.second())
}


/// 检查并自动推进循环待办（过期时间滚动到下一轮）
fn advance_recurring_todos(conn: &Connection, now_ms: i64) {
    // 先用块作用域收集结果以释放 conn 借用
    let rows: Vec<(String, i64, String, String)> = {
        let mut stmt = match conn.prepare(
            "SELECT id, due_date, recurrence_type, recurrence_config FROM todos WHERE is_recurring = 1 AND due_date > 0 AND due_date < ?1",
        ) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[LiteNote] 循环推进查询失败: {e}");
                return;
            }
        };

        let mapped = match stmt.query_map(rusqlite::params![now_ms], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        }) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[LiteNote] 循环推进查询失败: {e}");
                return;
            }
        };

        mapped.filter_map(|r| r.ok()).collect()
    }; // stmt 在此释放，conn 借用结束

    for (id, due_date, rec_type, rec_config) in &rows {
        if let Some(next_due) = compute_next_due(*due_date, rec_type, rec_config) {
            if let Err(e) = conn.execute(
                "UPDATE todos SET due_date = ?2, reminded = 0, update_time = ?3 WHERE id = ?1",
                rusqlite::params![id, next_due, now_ms],
            ) {
                eprintln!("[LiteNote] 循环推进更新失败 (id={}): {e}", id);
            } else {
                println!(
                    "[LiteNote] 循环待办 {} 自动推进: {} -> {}",
                    id, due_date, next_due
                );
            }
        }
    }
}

/// 与前端 `tauri-plugin-sql` 一致：数据库位于 app_config_dir/litenote.db
pub(crate) fn litenote_db_path<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("litenote.db"))
}

fn todos_table_exists(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='todos' LIMIT 1",
        [],
        |_| Ok(()),
    )
    .is_ok()
}

/// 待办行的最小字段集合（Rust 端开窗所需）
struct ReminderRow {
    id: String,
    text: String,
    due_date: i64,
}

/// 查询到当前应当弹出提醒的待办
/// - 命中条件：due_date > 0 且 due_date <= now + advance_ms 且 reminded = 0
///   即「距离到期不足 advance_ms 即触发」。注意 advance_ms 只参与一次比较，
///   不可用 `due_date - advance_ms <= now + advance_ms`，那样会变成 2 倍提前量。
fn query_due_reminders(conn: &Connection, now: i64, advance_ms: i64) -> Vec<ReminderRow> {
    let threshold = now + advance_ms;

    let mut stmt = match conn.prepare(
        "SELECT id, text, due_date \
         FROM todos \
         WHERE due_date > 0 \
           AND due_date <= ?1 \
           AND reminded = 0",
    ) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[LiteNote] 提醒查询 SQL 准备失败: {e}");
            return Vec::new();
        }
    };

    let rows = match stmt.query_map(
        rusqlite::params![threshold],
        |row| {
            Ok(ReminderRow {
                id: row.get(0)?,
                text: row.get(1)?,
                due_date: row.get(2)?,
            })
        },
    ) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[LiteNote] 提醒查询失败: {e}");
            return Vec::new();
        }
    };

    rows.filter_map(|r| r.ok()).collect()
}

/// 标记某条待办「本轮已提醒」，避免同一周期内重复弹
fn mark_reminded(conn: &Connection, id: &str) {
    if let Err(e) = conn.execute(
        "UPDATE todos SET reminded = 1 WHERE id = ?1",
        rusqlite::params![id],
    ) {
        eprintln!("[LiteNote] 标记已提醒失败 (id={}): {e}", id);
    }
}

/// 计算窗口显示位置：屏幕右上角（钉钉式），距离右边 16px、顶部 60px
///
/// 拿不到 monitor 信息时退回到左上 (60, 60)。
fn compute_reminder_position<R: Runtime>(app: &AppHandle<R>) -> (f64, f64) {
    // 默认右上角，跨平台安全值
    let win_w = 380.0_f64;
    let margin_right = 16.0_f64;
    let margin_top = 60.0_f64;

    if let Ok(Some(monitor)) = app.primary_monitor() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let lw = size.width as f64 / scale;
        // 屏幕宽减去弹窗宽再减右边距；不低于 0
        let x = (lw - win_w - margin_right).max(0.0);
        return (x, margin_top);
    }
    (60.0, 60.0)
}

/// 格式化通知正文：`待办内容 —— 还有 X 分钟到期`
fn format_due_text(text: &str, due_date_ms: i64, now_ms: i64) -> String {
    if due_date_ms <= 0 {
        return text.to_string();
    }
    let diff_ms = due_date_ms - now_ms;
    let abs_ms = diff_ms.abs();
    let total_min = abs_ms / 60_000;

    let time_part = if abs_ms < 30_000 {
        "已到截止时间".to_string()
    } else if diff_ms > 0 {
        if total_min < 60 {
            format!("还有 {} 分钟到期", total_min)
        } else {
            let h = total_min / 60;
            let m = total_min % 60;
            if m == 0 {
                format!("还有 {} 小时到期", h)
            } else {
                format!("还有 {} 小时 {} 分钟到期", h, m)
            }
        }
    } else {
        if total_min < 60 {
            format!("已逾期 {} 分钟", total_min)
        } else {
            let h = total_min / 60;
            let m = total_min % 60;
            if m == 0 {
                format!("已逾期 {} 小时", h)
            } else {
                format!("已逾期 {} 小时 {} 分钟", h, m)
            }
        }
    };
    format!("{} —— {}", text, time_part)
}

/// 从 settings 表读取 reminderMode 配置，默认 "popup"
fn read_reminder_mode(conn: &Connection) -> String {
    let has_table: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings' LIMIT 1",
            [],
            |_| Ok(()),
        )
        .is_ok();
    if !has_table {
        return "popup".to_string();
    }
    conn.query_row(
        "SELECT value FROM settings WHERE key = 'reminderMode'",
        [],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_else(|_| "popup".to_string())
}

/// 从 settings 表读取提醒提前量（分钟），默认 15
fn read_remind_advance_min(conn: &Connection) -> i64 {
    let has_table: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings' LIMIT 1",
            [],
            |_| Ok(()),
        )
        .is_ok();
    if !has_table {
        return 15;
    }
    let raw: String = match conn.query_row(
        "SELECT value FROM settings WHERE key = 'remindAdvanceMin'",
        [],
        |row| row.get::<_, String>(0),
    ) {
        Ok(v) => v,
        Err(_) => return 15,
    };
    // 前端 saveSetting 对数字用 JSON.stringify 存储（如 "15"，带引号），
    // 去掉首尾引号再解析，否则 parse::<i64>() 会失败而回退默认值。
    let trimmed = raw.trim().trim_matches('"');
    trimmed
        .parse::<i64>()
        .ok()
        .map(|m| m.clamp(1, 1440))
        .unwrap_or(15)
}

/// 统一打开数据库连接并启用 WAL + busy_timeout，降低与前端 tauri-plugin-sql
/// 及 webdav 模块并发访问同一文件时的锁竞争。
pub(crate) fn open_db(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| format!("打开 DB 失败: {e}"))?;
    let _ = conn.execute("PRAGMA journal_mode=WAL", []);
    let _ = conn.execute("PRAGMA busy_timeout=5000", []);
    Ok(conn)
}

pub(crate) fn read_setting_string(conn: &Connection, key: &str, default: &str) -> String {
    let has_table: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings' LIMIT 1",
            [],
            |_| Ok(()),
        )
        .is_ok();
    if !has_table {
        return default.to_string();
    }
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        [key],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_else(|_| default.to_string())
}

pub(crate) fn read_setting_bool(conn: &Connection, key: &str, default: bool) -> bool {
    let has_table: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings' LIMIT 1",
            [],
            |_| Ok(()),
        )
        .is_ok();
    if !has_table {
        return default;
    }
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        [key],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|v| serde_json::from_str::<bool>(&v).ok())
    .unwrap_or(default)
}

fn write_setting_bool<R: Runtime>(app: &AppHandle<R>, key: &str, value: bool) -> Result<(), String> {
    let db_path = litenote_db_path(app).ok_or_else(|| "无法获取数据库路径".to_string())?;
    let conn = open_db(&db_path)?;
    let json = if value { "true" } else { "false" };
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, json],
    )
    .map_err(|e| format!("写入设置失败: {e}"))?;
    Ok(())
}

fn read_focus_mode<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Some(db_path) = litenote_db_path(app) else {
        return false;
    };
    if !db_path.exists() {
        return false;
    }
    let Ok(conn) = Connection::open(&db_path) else {
        return false;
    };
    read_setting_bool(&conn, "focusMode", false)
}

fn read_always_on_top<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Some(db_path) = litenote_db_path(app) else {
        return false;
    };
    if !db_path.exists() {
        return false;
    }
    let Ok(conn) = Connection::open(&db_path) else {
        return false;
    };
    read_setting_bool(&conn, "alwaysOnTop", false)
}

fn build_tray_menu<R: Runtime>(
    app: &AppHandle<R>,
    focus_mode: bool,
    always_on_top: bool,
) -> tauri::Result<Menu<R>> {
    let show_i = MenuItem::with_id(app, "tray_show", "显示窗口", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let focus_i = CheckMenuItem::with_id(
        app,
        "tray_mode_focus",
        "专注模式",
        true,
        focus_mode,
        None::<&str>,
    )?;
    let manage_i = CheckMenuItem::with_id(
        app,
        "tray_mode_manage",
        "完整模式",
        true,
        !focus_mode,
        None::<&str>,
    )?;
    let pin_i = CheckMenuItem::with_id(
        app,
        "tray_always_on_top",
        "窗口置顶",
        true,
        always_on_top,
        None::<&str>,
    )?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit_i = MenuItem::with_id(app, "tray_quit", "退出", true, None::<&str>)?;
    Menu::with_items(
        app,
        &[&show_i, &sep1, &focus_i, &manage_i, &pin_i, &sep2, &quit_i],
    )
}

fn rebuild_tray_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let focus_mode = read_focus_mode(app);
    let always_on_top = read_always_on_top(app);
    let menu = build_tray_menu(app, focus_mode, always_on_top)?;
    if let Some(tray) = app.tray_by_id("litenote-tray") {
        tray.set_menu(Some(menu))?;
    }
    Ok(())
}

fn apply_focus_mode<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> Result<(), String> {
    write_setting_bool(app, "focusMode", enabled)?;
    rebuild_tray_menu(app).map_err(|e| format!("更新托盘菜单失败: {e}"))?;
    app.emit(
        SETTINGS_UPDATED_EVENT,
        serde_json::json!({ "ts": now_ms(), "source": "rust" }),
    )
    .map_err(|e| format!("通知前端失败: {e}"))?;
    Ok(())
}

fn toggle_focus_mode<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    apply_focus_mode(app, !read_focus_mode(app))
}

fn apply_always_on_top<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> Result<(), String> {
    write_setting_bool(app, "alwaysOnTop", enabled)?;
    if let Some(w) = app.get_webview_window("main") {
        w.set_always_on_top(enabled).map_err(|e| format!("设置置顶失败: {e}"))?;
    }
    rebuild_tray_menu(app).map_err(|e| format!("更新托盘菜单失败: {e}"))?;
    app.emit(
        SETTINGS_UPDATED_EVENT,
        serde_json::json!({ "ts": now_ms(), "source": "rust" }),
    )
    .map_err(|e| format!("通知前端失败: {e}"))?;
    Ok(())
}

fn toggle_always_on_top<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    apply_always_on_top(app, !read_always_on_top(app))
}

/// 创建并展示一条独立提醒弹窗（置顶 / 不可被主窗口遮挡）
fn show_reminder_window<R: Runtime>(app: &AppHandle<R>, row: &ReminderRow) {
    let label = format!("reminder-{}", row.id);

    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.unminimize();
        let _ = existing.show();
        return;
    }

    let text_param = urlencoding_simple(&row.text);
    let url = format!(
        "index.html?window=reminder&todoId={}&text={}&dueDate={}",
        urlencoding_simple(&row.id),
        text_param,
        row.due_date,
    );

    let (x, y) = compute_reminder_position(app);

    // 先以不可见方式创建，避免 build() 时窗口管理器将其放到屏幕中央
    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title("提醒")
        .inner_size(380.0, 160.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)            // 配合 WebView 透明背景，彻底去掉 1px 边
        .shadow(false)                // 卡片自带 box-shadow，不需要窗口级阴影
        .always_on_top(true)
        .skip_taskbar(true)
        .maximizable(false)
        .focused(false)               // 关键：首次弹出也不抢焦点，让用户主动点
        .visible(false);              // 先不可见，设好位置后再显示

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(TitleBarStyle::Transparent)
        .hidden_title(true);

    let result = builder.build();

    match result {
        Ok(win) => {
            // 设好位置再显示，确保窗口出现在正确位置（屏幕右上角）
            let _ = win.set_position(LogicalPosition::new(x, y));

            // 针对不同系统进行「不抢焦点」的显示
            #[cfg(target_os = "windows")]
            {
                if let Ok(hwnd) = win.hwnd() {
                    unsafe {
                        // SW_SHOWNOACTIVATE = 4 : 显示但不激活
                        extern "system" {
                            fn ShowWindow(hwnd: isize, nCmdShow: i32) -> i32;
                        }
                        ShowWindow(hwnd.0 as isize, 4);
                    }
                } else {
                    let _ = win.show();
                }
            }

            #[cfg(target_os = "macos")]
            {
                // macOS 上 .show() 配合 focused(false) 通常不抢焦点
                let _ = win.show();
            }

            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            {
                let _ = win.show();
            }

            println!("[LiteNote] 提醒弹窗已创建: label={}", label);
        }
        Err(e) => {
            eprintln!("[LiteNote] 创建提醒弹窗失败: {e}");
        }
    }
}

/// 极简 URL 编码（不引外部 crate），仅处理中文 / 空格 / 特殊字符
fn urlencoding_simple(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push_str(&format!("%{:02X}", b));
            }
        }
    }
    out
}

/// 检查并发送到期提醒（从 Rust 端直接操作 SQLite）
fn check_and_notify(app: &AppHandle, db_path: &std::path::Path) {
    if !db_path.exists() {
        return;
    }

    let conn = match Connection::open(db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[LiteNote] 提醒检查：无法打开数据库: {e}");
            return;
        }
    };

    if !todos_table_exists(&conn) {
        return;
    }

    // 读取用户设置的提醒方式与提前量
    let reminder_mode = read_reminder_mode(&conn);
    let advance_ms = read_remind_advance_min(&conn) * 60 * 1000;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    // 1. 提醒检查
    let rows = query_due_reminders(&conn, now, advance_ms);
    if !rows.is_empty() {
        println!(
            "[LiteNote] 发现 {} 条待办需要提醒 (mode={})",
            rows.len(),
            reminder_mode
        );
        for row in &rows {
            match reminder_mode.as_str() {
                "system" => {
                    // 系统通知：使用 tauri-plugin-notification
                    let body = format_due_text(&row.text, row.due_date, now);
                    if let Err(e) = app
                        .notification()
                        .builder()
                        .title("LiteNote 提醒")
                        .body(&body)
                        .show()
                    {
                        eprintln!("[LiteNote] 发送系统通知失败: {e}");
                    } else {
                        println!(
                            "[LiteNote] 系统通知已发送: label={}",
                            row.id
                        );
                    }
                }
                _ => {
                    // 默认弹窗
                    show_reminder_window(app, row);
                }
            }
            mark_reminded(&conn, &row.id);
        }
    }

    // 2. 循环待办自动推进
    advance_recurring_todos(&conn, now);
}

// ──────────────── 前端调用的 Tauri Commands ────────────────

/// 提醒窗口中的用户操作
/// - action = "snooze": 延后 delayMinutes 分钟，关闭弹窗
/// - action = "close" : 仅关闭弹窗（「我知道了」/×，不修改数据）
#[tauri::command]
fn reminder_action(
    app: AppHandle,
    todo_id: String,
    action: String,
    delay_minutes: Option<i64>,
) -> Result<(), String> {
    // 找到 db 路径
    let db_path = litenote_db_path(&app).ok_or_else(|| "无法获取数据库路径".to_string())?;
    if !db_path.exists() {
        return Err("数据库文件不存在".into());
    }

    let conn = Connection::open(&db_path).map_err(|e| format!("打开 DB 失败: {e}"))?;

    match action.as_str() {
        "snooze" => {
            let delay = delay_minutes.unwrap_or(5).max(1);
            // 在原有截止时间基础上叠加，不是从「现在」计算
            let current_due: i64 = conn
                .query_row(
                    "SELECT due_date FROM todos WHERE id = ?1",
                    rusqlite::params![todo_id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            let new_due = if current_due > 0 {
                current_due + delay * 60_000
            } else {
                now_ms() + delay * 60_000
            };
            conn.execute(
                "UPDATE todos SET due_date = ?2, reminded = 0, update_time = ?3 WHERE id = ?1",
                rusqlite::params![todo_id, new_due, now_ms()],
            )
            .map_err(|e| format!("更新失败: {e}"))?;
        }
        "close" => {
            // 「我知道了」/× 关闭弹窗，标记本轮已提醒
            conn.execute(
                "UPDATE todos SET reminded = 1, update_time = ?2 WHERE id = ?1",
                rusqlite::params![todo_id, now_ms()],
            )
            .map_err(|e| format!("更新失败: {e}"))?;
        }
        other => {
            return Err(format!("未知 action: {other}"));
        }
    }

    // 让前端自己 close 窗口，Rust 不动（避免 macOS 唤起主窗口）
    Ok(())
}

/// 前端隐藏窗口时调用：保存窗口状态再隐藏
#[tauri::command]
fn hide_main_window(app: AppHandle) -> Result<(), String> {
    let flags = if read_focus_mode(&app) {
        // 专注模式不写 SIZE，避免下次完整模式恢复到矮窗口
        StateFlags::POSITION
    } else {
        window_persist_flags()
    };
    app.save_window_state(flags).map_err(|e| format!("保存窗口状态失败: {e}"))?;
    if let Some(w) = app.get_webview_window("main") {
        w.hide().map_err(|e| format!("隐藏窗口失败: {e}"))?;
    }
    Ok(())
}

/// 切换专注 / 完整模式（托盘、快捷键、前端均可调用）
#[tauri::command]
fn set_focus_mode(app: AppHandle, enabled: bool) -> Result<(), String> {
    apply_focus_mode(&app, enabled)
}

/// 设置窗口置顶（托盘、快捷键、前端均可调用）
#[tauri::command]
fn set_always_on_top(app: AppHandle, enabled: bool) -> Result<(), String> {
    apply_always_on_top(&app, enabled)
}

/// 重新注册全局快捷键（前端修改快捷键设置后调用）
#[tauri::command]
fn update_shortcuts(app: AppHandle) -> Result<(), String> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| format!("取消注册快捷键失败: {e}"))?;
    register_all_shortcuts(&app)
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

/// 通过 AppHandle 读取布尔设置（供 webdav 模块使用）
pub(crate) fn read_setting_bool_app<R: Runtime>(app: &AppHandle<R>, key: &str, default: bool) -> bool {
    let Some(db_path) = litenote_db_path(app) else {
        return default;
    };
    if !db_path.exists() {
        return default;
    }
    let Ok(conn) = open_db(&db_path) else {
        return default;
    };
    read_setting_bool(&conn, key, default)
}

/// 通过 AppHandle 读取字符串设置（供 webdav 模块使用）
pub(crate) fn read_setting_string_app<R: Runtime>(
    app: &AppHandle<R>,
    key: &str,
    default: &str,
) -> String {
    let Some(db_path) = litenote_db_path(app) else {
        return default.to_string();
    };
    if !db_path.exists() {
        return default.to_string();
    }
    let Ok(conn) = open_db(&db_path) else {
        return default.to_string();
    };
    read_setting_string(&conn, key, default)
}

/// 从 settings 表读取快捷键配置并注册全局快捷键（空字符串 = 不注册）
fn register_all_shortcuts<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let (toggle_window, toggle_focus, toggle_pin) = match litenote_db_path(app) {
        Some(db_path) if db_path.exists() => match Connection::open(&db_path) {
            Ok(conn) => (
                read_setting_string(&conn, "shortcutToggleWindow", "CmdOrCtrl+Shift+L"),
                read_setting_string(&conn, "shortcutFocusMode", "CmdOrCtrl+Shift+F"),
                read_setting_string(&conn, "shortcutPin", "CmdOrCtrl+Shift+P"),
            ),
            Err(_) => (
                "CmdOrCtrl+Shift+L".to_string(),
                "CmdOrCtrl+Shift+F".to_string(),
                "CmdOrCtrl+Shift+P".to_string(),
            ),
        },
        _ => (
            "CmdOrCtrl+Shift+L".to_string(),
            "CmdOrCtrl+Shift+F".to_string(),
            "CmdOrCtrl+Shift+P".to_string(),
        ),
    };

    let mut errors: Vec<String> = Vec::new();

    if !toggle_window.is_empty() {
        let handle = app.clone();
        if let Err(e) = app.global_shortcut().on_shortcut(
            toggle_window.as_str(),
            move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    toggle_main_window(&handle);
                }
            },
        ) {
            errors.push(format!("{toggle_window}: {e}"));
        }
    }

    if !toggle_focus.is_empty() {
        if let Err(e) = app.global_shortcut().on_shortcut(
            toggle_focus.as_str(),
            move |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let _ = toggle_focus_mode(app);
                }
            },
        ) {
            errors.push(format!("{toggle_focus}: {e}"));
        }
    }

    if !toggle_pin.is_empty() {
        if let Err(e) = app.global_shortcut().on_shortcut(
            toggle_pin.as_str(),
            move |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let _ = toggle_always_on_top(app);
                }
            },
        ) {
            errors.push(format!("{toggle_pin}: {e}"));
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!("注册快捷键失败: {}", errors.join("; ")))
    }
}

/// 启动 Rust 端后台提醒轮询（独立于前端，确保 macOS 上窗口隐藏时也能可靠提醒）
fn start_rust_reminder_poll(app: &AppHandle) {
    let handle = app.clone();

    // 获取数据库路径（与 plugin-sql 的 app_config_dir 保持一致）
    let db_path = match litenote_db_path(app) {
        Some(p) => p,
        None => {
            eprintln!("[LiteNote] 无法获取应用配置目录");
            return;
        }
    };

    println!(
        "[LiteNote] 启动 Rust 端提醒轮询，数据库路径: {}",
        db_path.display()
    );

    tauri::async_runtime::spawn(async move {
        // 延迟 5 秒后首次检查，之后每 30 秒一次
        tokio::time::sleep(Duration::from_secs(5)).await;

        let mut interval =
            tokio::time::interval(Duration::from_secs(REMINDER_POLL_INTERVAL_SECS));
        // 跳过第一个即时 tick
        interval.tick().await;

        loop {
            interval.tick().await;
            let db_path = db_path.clone();
            let handle = handle.clone();

            // SQLite 是阻塞操作，放到 spawn_blocking 中执行
            let _ = tokio::task::spawn_blocking(move || {
                check_and_notify(&handle, &db_path);
            })
            .await;
        }
    });
}

fn tray_image<R: Runtime>(app: &AppHandle<R>) -> Image<'static> {
    if let Some(icon) = app.default_window_icon() {
        return Image::new_owned(icon.rgba().to_vec(), icon.width(), icon.height());
    }
    let mut rgba = Vec::with_capacity(32 * 32 * 4);
    for _ in 0..(32 * 32) {
        rgba.extend_from_slice(&[70u8, 140, 190, 255]);
    }
    Image::new_owned(rgba, 32, 32)
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        if let Ok(visible) = w.is_visible() {
            if visible {
                // 隐藏前保存窗口状态（位置 + 大小；专注模式不写 SIZE）
                let flags = if read_focus_mode(app) {
                    StateFlags::POSITION
                } else {
                    window_persist_flags()
                };
                let _ = app.save_window_state(flags);
                let _ = w.hide();
            } else {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            reminder_action,
            hide_main_window,
            set_focus_mode,
            set_always_on_top,
            update_shortcuts,
            webdav::webdav_set_config,
            webdav::webdav_get_config,
            webdav::webdav_test,
            webdav::webdav_sync_now,
            webdav::webdav_restore,
            webdav::webdav_status,
        ])
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_persist_flags())
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            // 小部件模式：Windows 不在任务栏显示；macOS 不在 Dock 显示（仅托盘）
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_skip_taskbar(true);
            }

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_maximizable(false);
                let always_on_top = read_always_on_top(app.handle());
                let _ = window.set_always_on_top(always_on_top);
            }

            #[cfg(target_os = "macos")]
            app.set_activation_policy(ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            let icon = tray_image(&handle);

            // macOS: 设置透明标题栏样式 + WebView 透明背景
            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_title_bar_style(TitleBarStyle::Transparent);

                    // 设置窗口背景色为透明
                    let _ = window.set_background_color(Some(tauri::utils::config::Color(0, 0, 0, 0)));
                }
            }

            let focus_mode = read_focus_mode(app.handle());
            let always_on_top = read_always_on_top(app.handle());
            let menu = build_tray_menu(app.handle(), focus_mode, always_on_top)?;

            let _tray = TrayIconBuilder::with_id("litenote-tray")
                .icon(icon)
                .tooltip("轻签 LiteNote")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "tray_quit" => {
                        app.exit(0);
                    }
                    "tray_show" => {
                        show_main_window(app);
                    }
                    "tray_mode_focus" => {
                        let _ = apply_focus_mode(app, true);
                    }
                    "tray_mode_manage" => {
                        let _ = apply_focus_mode(app, false);
                    }
                    "tray_always_on_top" => {
                        let _ = toggle_always_on_top(app);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    let app = tray.app_handle();
                    match event {
                        TrayIconEvent::DoubleClick {
                            button: MouseButton::Left,
                            ..
                        } => {
                            show_main_window(app);
                        }
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } => {
                            show_main_window(app);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            // 启动 Rust 端后台提醒轮询（独立于前端，macOS 窗口隐藏时也能可靠运行）
            start_rust_reminder_poll(app.handle());

            // 启动 Rust 端后台 WebDAV 同步轮询（仅启用时执行单向上传）
            webdav::start_webdav_sync_poll(app.handle());

            // 全局快捷键：从设置中读取配置并注册
            if let Err(e) = register_all_shortcuts(app.handle()) {
                eprintln!("[LiteNote] 全局快捷键注册失败: {e}");
            }

            // 启动后强制显示主窗口，避免 window-state 或上次隐藏导致「启动打不开」
            show_main_window(app.handle());

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = event {
                show_main_window(app_handle);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app_handle, event);
        });
}
