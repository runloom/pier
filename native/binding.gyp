{
  "targets": [
    {
      "target_name": "ghostty_native",
      "sources": ["src/addon.mm"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "libraries": [
        "<(module_root_dir)/build_swift/libGhosttyBridge.dylib",
        "-framework AppKit",
        "-framework Foundation",
        "-framework Metal",
        "-framework MetalKit",
        "-framework QuartzCore"
      ],
      "xcode_settings": {
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "MACOSX_DEPLOYMENT_TARGET": "13.0",
        "OTHER_CPLUSPLUSFLAGS": ["-fobjc-arc"],
        "OTHER_LDFLAGS": [
          "-Wl,-rpath,@loader_path",
          "-Wl,-rpath,@loader_path/../../build_swift"
        ]
      }
    }
  ]
}
