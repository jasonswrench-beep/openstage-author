// SPDX-License-Identifier: Apache-2.0
//! Demo mode, for OpenStage Studio's tutorial videos.
//!
//! Off unless the editor is started with `--demo-hook <endpoint> --demo-token <token>`. Then the page is told where Studio's
//! player listens (this computer only) and its demo-mode hook starts (`src/demohook`), and the window fills one display at
//! a fixed layout size, so every take of a tutorial looks the same. `--demo-workspace <folder>` is where examples are
//! copied to when a script opens one; `--monitor <n>` and `--layout-width <css pixels>` choose the display and the size.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

pub struct DemoSettings {
    endpoint: String,
    token: String,
    workspace: Option<String>,
    monitor: usize,
    layout_width: f64,
}

fn value_after(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

/// The demo settings, if the editor was started in demo mode with safe values: an address on this computer and a plain token.
pub fn from_args() -> Option<DemoSettings> {
    let args: Vec<String> = std::env::args().collect();
    let endpoint = value_after(&args, "--demo-hook")?;
    let token = value_after(&args, "--demo-token")?;
    let local = ["http://127.0.0.1:", "http://localhost:", "http://[::1]:"].iter().any(|p| endpoint.starts_with(p));
    let plain = (16..=128).contains(&token.len()) && token.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !(local && plain) {
        eprintln!("The demo-mode settings were refused: the hook only talks to this computer, with a plain token.");
        return None;
    }
    Some(DemoSettings {
        endpoint,
        token,
        workspace: value_after(&args, "--demo-workspace"),
        monitor: value_after(&args, "--monitor").and_then(|v| v.parse().ok()).unwrap_or(1).max(1),
        layout_width: value_after(&args, "--layout-width").and_then(|v| v.parse().ok()).unwrap_or(1280.0),
    })
}

/// A plugin that hands the settings to the page before its own scripts run.
pub fn plugin<R: Runtime>(s: &DemoSettings) -> TauriPlugin<R> {
    let settings = serde_json::json!({ "endpoint": s.endpoint, "token": s.token, "workspace": s.workspace });
    Builder::new("demo-mode").js_init_script(format!("window.__OPENSTAGE_DEMO_HOOK__ = {settings};")).build()
}

/// Fill the chosen display with the main window, at the layout size.
pub fn arrange<R: Runtime>(app: &tauri::App<R>, s: &DemoSettings) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else { return Ok(()) };
    let monitors = window.available_monitors()?;
    let primary = window.primary_monitor()?;
    let monitor = if s.monitor == 1 {
        primary.or_else(|| monitors.first().cloned())
    } else {
        let others: Vec<_> = monitors.iter().filter(|m| primary.as_ref().map(|p| p.name() != m.name()).unwrap_or(true)).cloned().collect();
        others.get(s.monitor - 2).cloned().or(primary)
    };
    if let Some(m) = monitor {
        window.set_position(*m.position())?;
        window.set_size(*m.size())?;
        window.set_zoom(m.size().width as f64 / (m.scale_factor() * s.layout_width))?;
    }
    window.set_title("OpenStage Author (demo mode)")?;
    window.set_fullscreen(true)?;
    window.set_focus()?;
    Ok(())
}
