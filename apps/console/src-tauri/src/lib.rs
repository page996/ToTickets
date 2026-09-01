use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsoleRuntimeConfig {
    schema_version: &'static str,
    api_base_url: String,
    events_url: String,
    operator_id: String,
    refresh_interval_ms: String,
    stale_after_ms: String,
}

fn required_environment(name: &str) -> Result<String, String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{name} is required"))
}

#[tauri::command]
fn get_console_runtime_config() -> Result<ConsoleRuntimeConfig, String> {
    Ok(ConsoleRuntimeConfig {
        schema_version: "console-runtime.v1",
        api_base_url: required_environment("CONSOLE_API_BASE_URL")?,
        events_url: required_environment("CONSOLE_EVENTS_URL")?,
        operator_id: required_environment("CONSOLE_OPERATOR_ID")?,
        refresh_interval_ms: required_environment("CONSOLE_REFRESH_INTERVAL_MS")?,
        stale_after_ms: required_environment("CONSOLE_STALE_AFTER_MS")?,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_console_runtime_config])
        .run(tauri::generate_context!())
        .expect("failed to run the console shell");
}
