//! WebDAV 同步模块
//!
//! 设计：
//! - 默认「单向上传」：本地 todos 表 → 远端单文件 `litenote.json`
//! - 提供「手动恢复」：拉取远端 JSON 覆盖本地（由前端在用户确认后调用）
//! - 坚果云等兼容 WebDAV 的网盘均可使用
//! - 密码使用 aes-gcm 简单加密后存入 settings 表（非明文）

use std::time::Duration;

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};

use crate::{
    litenote_db_path, now_ms, read_setting_bool, read_setting_bool_app, read_setting_string,
    read_setting_string_app, SETTINGS_UPDATED_EVENT,
};

/// 远端文件名（存于用户配置的 remotePath 目录下，默认 /LiteNote/litenote.json）
const DEFAULT_REMOTE_PATH: &str = "/LiteNote/litenote.json";

/// 后台定时同步间隔（秒）
const SYNC_POLL_INTERVAL_SECS: u64 = 300;

/// 简单加密密钥派生：基于固定 salt + 应用标识（设备级弱密钥，仅防明文泄漏）
const ENC_KEY_SALT: &[u8] = b"litenote-webdav-salt";
/// AES-GCM 要求 nonce 恰好 12 字节
const ENC_NONCE: &[u8] = b"litenote_12b"; // 恰好 12 字节：litenote(8)+_(1)+12b(3)
const _NONCE_LEN_CHECK: () = assert!(ENC_NONCE.len() == 12, "ENC_NONCE 必须是 12 字节");

// ──────────────── 同步数据模型 ────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
struct TodoItemSync {
    id: String,
    text: String,
    completed: bool,
    #[serde(default)]
    pinned: bool,
    #[serde(default)]
    color_id: Option<String>,
    #[serde(default)]
    due_date: i64,
    #[serde(default)]
    reminded: bool,
    #[serde(default)]
    is_recurring: bool,
    #[serde(default)]
    recurrence_type: String,
    #[serde(default)]
    recurrence_config: String,
    #[serde(default)]
    update_time: i64,
    #[serde(default)]
    create_time: i64,
}

#[derive(Serialize, Deserialize, Debug)]
struct SyncFile {
    version: u32,
    updated_at: i64,
    todos: Vec<TodoItemSync>,
}

#[derive(Serialize, Deserialize, Debug)]
pub(crate) struct WebdavStatus {
    enabled: bool,
    last_sync: i64,
}

// ──────────────── 加密（密码存储用） ────────────────

fn derive_key() -> [u8; 32] {
    // 简单派生：固定 salt + 固定串，取前 32 字节。仅用于「不落明文」，非高安全场景。
    use std::io::Write;
    let mut data = Vec::new();
    let _ = data.write_all(b"litenote-webdav-secret");
    let _ = data.write_all(ENC_KEY_SALT);
    let mut key = [0u8; 32];
    for (i, b) in data.iter().cycle().take(32).enumerate() {
        key[i] = *b;
    }
    key
}

fn encrypt_secret(plain: &str) -> Result<String, String> {
    if ENC_NONCE.len() != 12 {
        eprintln!("[webdav] 加密失败：ENC_NONCE 长度 {} != 12", ENC_NONCE.len());
        return Err(format!("加密 nonce 长度错误: {} 字节（需 12）", ENC_NONCE.len()));
    }
    let cipher = Aes256Gcm::new_from_slice(&derive_key()).map_err(|e| format!("加密初始化失败: {e}"))?;
    let nonce = Nonce::from_slice(ENC_NONCE);
    let ciphertext = cipher
        .encrypt(nonce, plain.as_bytes())
        .map_err(|e| format!("加密失败: {e}"))?;
    Ok(B64.encode(ciphertext))
}

fn decrypt_secret(cipher_b64: &str) -> Result<String, String> {
    if ENC_NONCE.len() != 12 {
        eprintln!("[webdav] 解密失败：ENC_NONCE 长度 {} != 12", ENC_NONCE.len());
        return Err(format!("解密 nonce 长度错误: {} 字节（需 12）", ENC_NONCE.len()));
    }
    let cipher = Aes256Gcm::new_from_slice(&derive_key()).map_err(|e| format!("解密初始化失败: {e}"))?;
    let nonce = Nonce::from_slice(ENC_NONCE);
    let bytes = B64.decode(cipher_b64).map_err(|e| format!("密文解码失败: {e}"))?;
    let plain = cipher
        .decrypt(nonce, bytes.as_ref())
        .map_err(|_| "密码解密失败（可能已损坏）".to_string())?;
    String::from_utf8(plain).map_err(|e| format!("密码编码失败: {e}"))
}

// ──────────────── settings 读写 ────────────────

fn write_setting_string<R: Runtime>(app: &AppHandle<R>, key: &str, value: &str) -> Result<(), String> {
    let db_path = litenote_db_path(app).ok_or_else(|| "无法获取数据库路径".to_string())?;
    let conn = Connection::open(&db_path).map_err(|e| format!("打开 DB 失败: {e}"))?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )
    .map_err(|e| format!("写入设置失败: {e}"))?;
    Ok(())
}

// ──────────────── WebDAV 客户端 ────────────────

fn build_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        // 坚果云等使用有效 SSL 证书；此处不跳过校验
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败: {e}"))
}

/// 确保远端目录存在（逐级 MKCOL）。remote_path 形如 /LiteNote/litenote.json
fn ensure_remote_dir(client: &reqwest::blocking::Client, base: &str, auth: &reqwest::header::HeaderValue, remote_path: &str) -> Result<(), String> {
    // 取目录部分：去掉 remote_path 末尾的文件名
    let dir = match remote_path.trim_start_matches('/').rsplit_once('/') {
        Some((d, _)) if !d.is_empty() => d.to_string(),
        _ => return Ok(()), // 没有子目录，无需创建
    };
    let base = base.trim_end_matches('/');
    // 逐级拼接 remote_path 的目录分段并 MKCOL（已存在的目录返回 405/409，忽略）
    let mut cur = base.to_string();
    for seg in dir.split('/') {
        if seg.is_empty() {
            continue;
        }
        cur.push('/');
        cur.push_str(seg);
        let mkcol = http::Method::from_bytes(b"MKCOL")
            .map_err(|e| format!("构造 MKCOL 方法失败: {e}"))?;
        let resp = client
            .request(mkcol, &cur)
            .header(reqwest::header::AUTHORIZATION, auth.clone())
            .send();
        match resp {
            Ok(r) => {
                let s = r.status();
                // 201 创建成功；405/409 已存在，可接受；其他错误打印日志
                if !s.is_success() && s.as_u16() != 405 && s.as_u16() != 409 {
                    eprintln!("[webdav] MKCOL {} -> {}", cur, s);
                }
            }
            Err(e) => eprintln!("[webdav] MKCOL {} 请求失败: {}", cur, e),
        }
    }
    Ok(())
}

fn normalize_remote_url(base: &str, remote_path: &str) -> String {
    let base = base.trim_end_matches('/');
    let rp = remote_path.trim_start_matches('/');
    format!("{base}/{rp}")
}

fn basic_auth_header(user: &str, pass: &str) -> Result<reqwest::header::HeaderValue, String> {
    let raw = format!("{}:{}", user, pass);
    let encoded = B64.encode(raw);
    reqwest::header::HeaderValue::from_str(&format!("Basic {encoded}")).map_err(|e| format!("认证头构造失败: {e}"))
}

// ──────────────── 本地数据读取 / 写入 ────────────────

fn read_local_todos<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<TodoItemSync>, String> {
    let db_path = litenote_db_path(app).ok_or_else(|| "无法获取数据库路径".to_string())?;
    if !db_path.exists() {
        return Ok(Vec::new());
    }
    let conn = Connection::open(&db_path).map_err(|e| format!("打开 DB 失败: {e}"))?;
    let has_table = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='todos' LIMIT 1",
            [],
            |_| Ok(()),
        )
        .is_ok();
    if !has_table {
        return Ok(Vec::new());
    }

    let mut stmt = conn
        .prepare(
            "SELECT id, text, completed, pinned, color_id, due_date, reminded, \
             is_recurring, recurrence_type, recurrence_config, update_time, create_time \
             FROM todos",
        )
        .map_err(|e| format!("查询待办失败: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(TodoItemSync {
                id: row.get(0)?,
                text: row.get(1)?,
                completed: row.get(2)?,
                pinned: row.get(3)?,
                color_id: row.get(4)?,
                due_date: row.get(5)?,
                reminded: row.get(6)?,
                is_recurring: row.get(7)?,
                recurrence_type: row.get(8)?,
                recurrence_config: row.get(9)?,
                update_time: row.get(10)?,
                create_time: row.get(11)?,
            })
        })
        .map_err(|e| format!("读取待办失败: {e}"))?;

    let todos: Vec<TodoItemSync> = rows.filter_map(|r| r.ok()).collect();
    Ok(todos)
}

/// 用远端数据覆盖本地（手动恢复）
fn overwrite_local_todos<R: Runtime>(app: &AppHandle<R>, sync: &SyncFile) -> Result<(), String> {
    let db_path = litenote_db_path(app).ok_or_else(|| "无法获取数据库路径".to_string())?;
    let conn = Connection::open(&db_path).map_err(|e| format!("打开 DB 失败: {e}"))?;

    // 清空并重新插入
    conn.execute("DELETE FROM todos", [])
        .map_err(|e| format!("清空本地数据失败: {e}"))?;

    for item in &sync.todos {
        conn.execute(
            "INSERT INTO todos \
             (id, text, completed, pinned, color_id, due_date, reminded, is_recurring, recurrence_type, recurrence_config, update_time, create_time) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12) \
             ON CONFLICT(id) DO UPDATE SET \
             text=excluded.text, completed=excluded.completed, pinned=excluded.pinned, \
             color_id=excluded.color_id, due_date=excluded.due_date, reminded=excluded.reminded, \
             is_recurring=excluded.is_recurring, recurrence_type=excluded.recurrence_type, \
             recurrence_config=excluded.recurrence_config, update_time=excluded.update_time, \
             create_time=excluded.create_time",
            rusqlite::params![
                item.id,
                item.text,
                item.completed,
                item.pinned,
                item.color_id,
                item.due_date,
                item.reminded,
                item.is_recurring,
                item.recurrence_type,
                item.recurrence_config,
                item.update_time,
                item.create_time,
            ],
        )
        .map_err(|e| format!("写入待办失败: {e}"))?;
    }

    Ok(())
}

// ──────────────── 核心同步逻辑 ────────────────

/// 可选的配置覆盖（来自当前输入框的临时值，优先于已保存配置）
struct ConfigOverride {
    url: Option<String>,
    user: Option<String>,
    pass: Option<String>,
    remote_path: Option<String>,
}

fn get_config<R: Runtime>(
    app: &AppHandle<R>,
    ov: Option<&ConfigOverride>,
) -> Result<(String, String, String, String, bool), String> {
    let enabled = read_setting_bool_app(app, "webdavEnabled", false);
    if !enabled {
        return Err("WebDAV 同步未启用".into());
    }
    let url = ov.and_then(|o| o.url.clone()).filter(|s| !s.is_empty())
        .unwrap_or_else(|| read_setting_string_app(app, "webdavUrl", ""));
    let user = ov.and_then(|o| o.user.clone()).filter(|s| !s.is_empty())
        .unwrap_or_else(|| read_setting_string_app(app, "webdavUser", ""));
    // 优先用传入的明文密码；否则回退已保存（加密）的密码
    let pass = if let Some(p) = ov.and_then(|o| o.pass.clone()).filter(|s| !s.is_empty()) {
        p
    } else {
        let pass_enc = read_setting_string_app(app, "webdavPass", "");
        if pass_enc.is_empty() {
            return Err("WebDAV 配置不完整，请先在设置中填写服务器地址、账号和密码".into());
        }
        decrypt_secret(&pass_enc)?
    };
    let remote_path = ov.and_then(|o| o.remote_path.clone()).filter(|s| !s.is_empty())
        .unwrap_or_else(|| read_setting_string_app(app, "webdavRemotePath", DEFAULT_REMOTE_PATH));

    if url.is_empty() || user.is_empty() {
        return Err("WebDAV 配置不完整，请先在设置中填写服务器地址、账号和密码".into());
    }

    Ok((url, user, pass, remote_path, enabled))
}

/// 上传本地 todos 到 WebDAV（单向）
fn upload_to_webdav<R: Runtime>(app: &AppHandle<R>, ov: Option<&ConfigOverride>) -> Result<(), String> {
    let (url, user, pass, remote_path, _enabled) = get_config(app, ov)?;

    let todos = read_local_todos(app)?;
    let sync_file = SyncFile {
        version: 1,
        updated_at: now_ms(),
        todos,
    };
    let body = serde_json::to_string(&sync_file).map_err(|e| format!("序列化失败: {e}"))?;

    let client = build_client()?;
    let auth = basic_auth_header(&user, &pass)?;

    // 确保远端目录存在
    ensure_remote_dir(&client, &url, &auth, &remote_path)?;

    let full = normalize_remote_url(&url, &remote_path);
    eprintln!("[webdav] upload: PUT {}", full);
    let resp = client
        .put(&full)
        .header(reqwest::header::AUTHORIZATION, auth.clone())
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .map_err(|e| format!("上传请求失败: {e}"))?;

    if !resp.status().is_success() {
        eprintln!("[webdav] upload: 失败状态码 {}", resp.status());
        return Err(format!("上传失败，服务器返回 {} {}", resp.status(), resp.status()));
    }
    eprintln!("[webdav] upload: 成功");

    set_last_sync(app, now_ms())?;
    Ok(())
}

/// 从 WebDAV 下载并覆盖本地（手动恢复）
fn download_from_webdav<R: Runtime>(app: &AppHandle<R>, ov: Option<&ConfigOverride>) -> Result<(), String> {
    let (url, user, pass, remote_path, _enabled) = get_config(app, ov)?;

    let client = build_client()?;
    let auth = basic_auth_header(&user, &pass)?;
    let full = normalize_remote_url(&url, &remote_path);

    let resp = client
        .get(&full)
        .header(reqwest::header::AUTHORIZATION, auth.clone())
        .send()
        .map_err(|e| format!("下载请求失败: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("下载失败，服务器返回 {} {}", resp.status(), resp.status()));
    }

    let body = resp.text().map_err(|e| format!("读取响应失败: {e}"))?;
    let sync_file: SyncFile = serde_json::from_str(&body).map_err(|e| format!("解析远端数据失败: {e}"))?;

    overwrite_local_todos(app, &sync_file)?;
    set_last_sync(app, now_ms())?;
    Ok(())
}

fn set_last_sync<R: Runtime>(app: &AppHandle<R>, ts: i64) -> Result<(), String> {
    write_setting_string(app, "webdavLastSync", &ts.to_string())?;
    // 通知前端更新
    let _ = app.emit(
        SETTINGS_UPDATED_EVENT,
        serde_json::json!({ "ts": now_ms(), "source": "webdav" }),
    );
    Ok(())
}

/// 后台定时上传（仅 enabled 时）
fn sync_tick<R: Runtime>(app: &AppHandle<R>) {
    let db_path = match litenote_db_path(app) {
        Some(p) => p,
        None => return,
    };
    if !db_path.exists() {
        return;
    }
    let enabled = read_setting_bool_app(app, "webdavEnabled", false);
    if !enabled {
        return;
    }
    let handle = app.clone();
    if let Err(e) = upload_to_webdav(&handle, None) {
        eprintln!("[LiteNote] WebDAV 后台上传失败: {e}");
        let _ = set_last_sync(&handle, now_ms());
    } else {
        println!("[LiteNote] WebDAV 后台上传成功");
        let _ = set_last_sync(&handle, now_ms());
    }
}

/// 启动 Rust 端后台同步轮询（仅在启用时执行一次上传）
pub fn start_webdav_sync_poll<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        // 启动 10 秒后首次同步
        tokio::time::sleep(Duration::from_secs(10)).await;

        let mut interval = tokio::time::interval(Duration::from_secs(SYNC_POLL_INTERVAL_SECS));
        interval.tick().await; // 跳过首个即时 tick

        loop {
            interval.tick().await;
            let handle = handle.clone();
            let _ = tokio::task::spawn_blocking(move || {
                sync_tick(&handle);
            })
            .await;
        }
    });
}

// ──────────────── Tauri Commands ────────────────

#[derive(Serialize, Deserialize)]
pub struct WebdavConfigPayload {
    pub enabled: Option<bool>,
    pub url: Option<String>,
    pub user: Option<String>,
    pub pass: Option<String>,
    pub remote_path: Option<String>,
}

/// 设置 WebDAV 配置（密码加密存储）
#[tauri::command]
pub async fn webdav_set_config(app: AppHandle, config: WebdavConfigPayload) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(enabled) = config.enabled {
            write_setting_string(&app, "webdavEnabled", &serde_json::to_string(&enabled).unwrap())?;
        }
        if let Some(url) = config.url {
            write_setting_string(&app, "webdavUrl", &url)?;
        }
        if let Some(user) = config.user {
            write_setting_string(&app, "webdavUser", &user)?;
        }
        if let Some(pass) = config.pass {
            if !pass.is_empty() {
                let enc = encrypt_secret(&pass)?;
                write_setting_string(&app, "webdavPass", &enc)?;
            }
        }
        if let Some(remote_path) = config.remote_path {
            let rp = if remote_path.trim().is_empty() {
                DEFAULT_REMOTE_PATH.to_string()
            } else {
                remote_path
            };
            write_setting_string(&app, "webdavRemotePath", &rp)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

/// 获取当前配置（密码解密后以明文返回，方便前端回填输入框）
#[tauri::command]
pub async fn webdav_get_config(app: AppHandle) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = litenote_db_path(&app).ok_or_else(|| "无法获取数据库路径".to_string())?;
        let conn = Connection::open(&db_path).map_err(|e| format!("打开 DB 失败: {e}"))?;
        let enabled = read_setting_bool(&conn, "webdavEnabled", false);
        let url = read_setting_string(&conn, "webdavUrl", "");
        let user = read_setting_string(&conn, "webdavUser", "");
        let remote_path = read_setting_string(&conn, "webdavRemotePath", DEFAULT_REMOTE_PATH);
        let pass_enc = read_setting_string(&conn, "webdavPass", "");
        let pass_set = !pass_enc.is_empty();
        // 解密容错：损坏的密文返回空，不阻断获取配置
        let pass = if pass_set {
            decrypt_secret(&pass_enc).unwrap_or_default()
        } else {
            String::new()
        };
        let last_sync: i64 = read_setting_string(&conn, "webdavLastSync", "0")
            .parse()
            .unwrap_or(0);

        Ok(serde_json::json!({
            "enabled": enabled,
            "url": url,
            "user": user,
            "remotePath": remote_path,
            "pass": pass,
            "passSet": pass_set,
            "lastSync": last_sync,
        }))
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

/// 测试连接请求参数（使用当前输入框的临时值，不依赖已保存配置）
#[derive(Serialize, Deserialize)]
pub struct WebdavTestPayload {
    pub url: String,
    pub user: String,
    pub pass: String,
    pub remote_path: Option<String>,
}

/// 测试连接（PROPFIND 根目录）。直接使用传入的临时配置，避免把不完整配置写库。
/// 若传入的 pass 为空且数据库已存有密码，则回退使用已保存密码。
#[tauri::command]
pub async fn webdav_test(app: AppHandle, payload: WebdavTestPayload) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let url = payload.url.trim();
        let user = payload.user.trim();
        let mut pass = payload.pass;
        if pass.is_empty() {
            let saved = read_setting_string_app(&app, "webdavPass", "");
            if !saved.is_empty() {
                pass = decrypt_secret(&saved)?;
            }
        }
        if url.is_empty() || user.is_empty() || pass.is_empty() {
            return Err("请先填写服务器地址、账号和密码".into());
        }
        let client = build_client()?;
        let auth = basic_auth_header(&user, &pass)?;
        let root = url.trim_end_matches('/').to_string();
        eprintln!("[webdav] test: PROPFIND {}", root);
        let propfind = http::Method::from_bytes(b"PROPFIND")
            .map_err(|e| format!("构造 PROPFIND 方法失败: {e}"))?;
        let resp = client
            .request(propfind, &root)
            .header(reqwest::header::AUTHORIZATION, auth)
            .header("Depth", "0")
            .send()
            .map_err(|e| format!("连接测试失败: {e}"))?;
        eprintln!("[webdav] test: 状态码 {}", resp.status());
        if resp.status().is_success() || resp.status().as_u16() == 207 {
            Ok("连接成功".into())
        } else {
            Err(format!("连接失败，服务器返回 {} {}", resp.status(), resp.status()))
        }
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

/// 立即上传（单向同步到云端）。可传入当前输入框的临时配置覆盖已保存配置。
#[tauri::command]
pub async fn webdav_sync_now(app: AppHandle, payload: Option<WebdavTestPayload>) -> Result<String, String> {
    let ov = payload.map(|p| ConfigOverride {
        url: Some(p.url),
        user: Some(p.user),
        pass: Some(p.pass),
        remote_path: p.remote_path,
    });
    tauri::async_runtime::spawn_blocking(move || match upload_to_webdav(&app, ov.as_ref()) {
        Ok(_) => {
            let _ = set_last_sync(&app, now_ms());
            Ok("同步成功".into())
        }
        Err(e) => {
            let _ = set_last_sync(&app, now_ms());
            Err(e)
        }
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

/// 从云端恢复（下载覆盖本地，危险操作）。可传入当前输入框的临时配置覆盖已保存配置。
#[tauri::command]
pub async fn webdav_restore(app: AppHandle, payload: Option<WebdavTestPayload>) -> Result<String, String> {
    let ov = payload.map(|p| ConfigOverride {
        url: Some(p.url),
        user: Some(p.user),
        pass: Some(p.pass),
        remote_path: p.remote_path,
    });
    tauri::async_runtime::spawn_blocking(move || match download_from_webdav(&app, ov.as_ref()) {
        Ok(_) => {
            let _ = set_last_sync(&app, now_ms());
            Ok("已从云端恢复".into())
        }
        Err(e) => {
            let _ = set_last_sync(&app, now_ms());
            Err(e)
        }
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}

#[tauri::command]
pub async fn webdav_status(app: AppHandle) -> Result<WebdavStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = litenote_db_path(&app).ok_or_else(|| "无法获取数据库路径".to_string())?;
        let conn = Connection::open(&db_path).map_err(|e| format!("打开 DB 失败: {e}"))?;
        let enabled = read_setting_bool(&conn, "webdavEnabled", false);
        let last_sync: i64 = read_setting_string(&conn, "webdavLastSync", "0")
            .parse()
            .unwrap_or(0);
        Ok(WebdavStatus {
            enabled,
            last_sync,
        })
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}
