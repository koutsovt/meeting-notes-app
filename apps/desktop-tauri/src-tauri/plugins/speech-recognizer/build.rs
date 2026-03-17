const COMMANDS: &[&str] = &["start", "stop", "check_permissions", "request_permissions"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .ios_path("ios")
        .build();
}
