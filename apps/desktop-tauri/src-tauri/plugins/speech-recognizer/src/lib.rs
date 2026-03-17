use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(mobile)]
mod mobile;
mod commands;
mod models;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("speech-recognizer")
        .invoke_handler(tauri::generate_handler![
            commands::start,
            commands::stop,
            commands::check_permissions,
            commands::request_permissions,
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            {
                use tauri::Manager;
                let sr = mobile::init(app, api)?;
                app.manage(sr);
            }
            #[cfg(not(mobile))]
            {
                let _ = (app, api);
            }
            Ok(())
        })
        .build()
}
