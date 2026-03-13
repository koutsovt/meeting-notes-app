fn main() {
    // Swift concurrency runtime (@rpath/libswift_Concurrency.dylib) needed by ScreenCaptureKit bridge
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    tauri_build::build()
}
