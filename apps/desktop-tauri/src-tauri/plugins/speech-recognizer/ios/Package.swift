// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "tauri-plugin-speech-recognizer",
    platforms: [
        .iOS(.v14)
    ],
    products: [
        .library(
            name: "tauri-plugin-speech-recognizer",
            type: .static,
            targets: ["tauri-plugin-speech-recognizer"]
        )
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api")
    ],
    targets: [
        .target(
            name: "tauri-plugin-speech-recognizer",
            dependencies: [
                .product(name: "Tauri", package: "Tauri")
            ],
            path: "Sources"
        )
    ]
)
