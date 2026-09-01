fn main() {
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(&["get_console_runtime_config"]));
    tauri_build::try_build(attributes).expect("failed to prepare the console Tauri build")
}
