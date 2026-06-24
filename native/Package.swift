// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "GhosttyBridge",
    platforms: [.macOS(.v13)],
    products: [
        .library(
            name: "GhosttyBridge",
            type: .dynamic,
            targets: ["GhosttyBridge"]
        ),
    ],
    dependencies: [
        .package(
            path: "Vendor/libghostty-spm"
        ),
    ],
    targets: [
        .target(
            name: "GhosttyBridge",
            dependencies: [
                .product(name: "GhosttyTerminal", package: "libghostty-spm"),
                .product(name: "GhosttyTheme", package: "libghostty-spm"),
            ],
            swiftSettings: [
                .unsafeFlags(["-Xfrontend", "-enable-objc-interop"]),
            ]
        ),
        .testTarget(
            name: "GhosttyBridgeTests",
            dependencies: ["GhosttyBridge"]
        ),
    ]
)
