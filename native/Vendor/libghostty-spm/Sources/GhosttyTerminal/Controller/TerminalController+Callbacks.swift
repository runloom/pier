//
//  TerminalController+Callbacks.swift
//  libghostty-spm
//

import Foundation
import GhosttyKit

#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

// Internal (not private) so GhosttyBridgeTests can drive the real clipboard
// callbacks with fabricated C payloads.
enum TerminalCallbacks {
    #if canImport(AppKit)
        private static let terminalPasteImageDirectoryName = "pier-terminal-pastes"
        private static let terminalPasteImageRetentionInterval: TimeInterval = 24 * 60 * 60

        private static func terminalPasteImagePathFromPasteboard(
            _ pasteboard: NSPasteboard
        ) -> String? {
            guard let pngData = terminalPastePngData(from: pasteboard) else {
                return nil
            }

            let fileManager = FileManager.default
            let directory = fileManager.temporaryDirectory.appendingPathComponent(
                terminalPasteImageDirectoryName,
                isDirectory: true
            )

            do {
                try fileManager.createDirectory(
                    at: directory,
                    withIntermediateDirectories: true
                )
                cleanupTerminalPasteImages(in: directory)

                let url = directory.appendingPathComponent(
                    "clipboard-\(UUID().uuidString).png"
                )
                try pngData.write(to: url, options: [.atomic])
                TerminalDebugLog.log(
                    .input,
                    "clipboard image paste materialized path=\(url.path) bytes=\(pngData.count)"
                )
                return url.path
            } catch {
                TerminalDebugLog.log(
                    .input,
                    "clipboard image paste write failed: \(error.localizedDescription)"
                )
                return nil
            }
        }

        private static func terminalPastePngData(from pasteboard: NSPasteboard) -> Data? {
            if let data = pasteboard.data(forType: .png), !data.isEmpty {
                return data
            }

            if let data = pasteboard.data(forType: .tiff),
               let pngData = terminalPastePngData(fromTiffData: data)
            {
                return pngData
            }

            guard let images = pasteboard.readObjects(
                forClasses: [NSImage.self],
                options: nil
            ) as? [NSImage] else {
                return nil
            }
            return images.compactMap(terminalPastePngData(from:)).first
        }

        private static func terminalPastePngData(from image: NSImage) -> Data? {
            guard let tiffData = image.tiffRepresentation else {
                return nil
            }
            return terminalPastePngData(fromTiffData: tiffData)
        }

        private static func terminalPastePngData(fromTiffData data: Data) -> Data? {
            guard let bitmap = NSBitmapImageRep(data: data) else {
                return nil
            }
            return bitmap.representation(using: .png, properties: [:])
        }

        private static func cleanupTerminalPasteImages(in directory: URL) {
            let fileManager = FileManager.default
            guard let urls = try? fileManager.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: [.contentModificationDateKey],
                options: [.skipsHiddenFiles]
            ) else {
                return
            }

            let cutoff = Date().addingTimeInterval(-terminalPasteImageRetentionInterval)
            for url in urls
                where url.lastPathComponent.hasPrefix("clipboard-")
                    && url.pathExtension.lowercased() == "png"
            {
                let values = try? url.resourceValues(forKeys: [.contentModificationDateKey])
                if (values?.contentModificationDate ?? .distantPast) < cutoff {
                    try? fileManager.removeItem(at: url)
                }
            }
        }
    #endif

    static func wakeup(userdata: UnsafeMutableRawPointer?) {
        guard let userdata else { return }
        let controller = Unmanaged<TerminalController>.fromOpaque(userdata)
            .takeUnretainedValue()
        terminalRunOnMain {
            controller.handleWakeup()
        }
    }

    static func action(
        appPtr: ghostty_app_t?,
        target: ghostty_target_s,
        action: ghostty_action_s
    ) -> Bool {
        if action.tag == GHOSTTY_ACTION_RELOAD_CONFIG,
           action.action.reload_config.soft,
           let appPtr, let userdata = ghostty_app_userdata(appPtr)
        {
            let controller = Unmanaged<TerminalController>.fromOpaque(userdata)
                .takeUnretainedValue()
            // Ghostty requests a soft reload after changing its conditional
            // state on the main thread. Complete it before returning: the next
            // queued scheme report reads the reloaded config, not pending state.
            return MainActor.assumeIsolated {
                guard let config = controller.config else { return false }
                switch target.tag {
                case GHOSTTY_TARGET_APP:
                    guard let app = controller.app else { return false }
                    ghostty_app_update_config(app, config)
                case GHOSTTY_TARGET_SURFACE:
                    guard let surface = target.target.surface else { return false }
                    ghostty_surface_update_config(surface, config)
                default:
                    return false
                }
                return true
            }
        }

        guard target.tag == GHOSTTY_TARGET_SURFACE,
              let surfacePtr = target.target.surface,
              let bridgePtr = ghostty_surface_userdata(surfacePtr)
        else { return false }

        let bridge = Unmanaged<TerminalCallbackBridge>
            .fromOpaque(bridgePtr)
            .takeUnretainedValue()
        terminalRunOnMain {
            bridge.handleAction(action)
        }

        // Returning true tells Ghostty the host consumed the action.
        // - OPEN_URL: false falls back to the OS opener (dual-open with Pier).
        // - SHOW_CHILD_EXITED: false prints hardcoded English into the terminal
        //   buffer; true lets Pier show an i18n banner instead.
        switch action.tag {
        case GHOSTTY_ACTION_OPEN_URL, GHOSTTY_ACTION_SHOW_CHILD_EXITED:
            return true
        default:
            return false
        }
    }

    static func closeSurface(
        userdata: UnsafeMutableRawPointer?,
        processAlive: Bool
    ) {
        guard let userdata else { return }
        let bridge = Unmanaged<TerminalCallbackBridge>
            .fromOpaque(userdata)
            .takeUnretainedValue()
        terminalRunOnMain {
            bridge.handleClose(processAlive: processAlive)
        }
    }

    static func writeClipboard(
        userdata _: UnsafeMutableRawPointer?,
        clipboard: ghostty_clipboard_e,
        contents: UnsafePointer<ghostty_clipboard_content_s>?,
        contentsLen: Int,
        confirm: Bool
    ) {
        guard let kind = TerminalClipboardKind(clipboard) else {
            TerminalDebugLog.log(
                .input,
                "clipboard write dropped unsupported kind raw=\(clipboard.rawValue)"
            )
            return
        }
        // confirm=true means ghostty expects a host write-confirm UI
        // (clipboard-write = ask). Pier has no authorize-copy UI —
        // ClipboardConfirmAlert is paste-protection (confirm_read_clipboard)
        // only and never fires for OSC 52 writes — so fail closed instead of
        // silently allowing an unconfirmed write. Unreachable with
        // Pier-generated config (clipboard-write keeps the ghostty default:
        // allow).
        guard !confirm else {
            TerminalDebugLog.log(
                .input,
                "clipboard write denied confirm-required kind=\(kind.debugLabel)"
            )
            return
        }
        guard contentsLen > 0 else { return }
        guard let content = contents?.pointee else { return }
        guard let data = content.data else { return }
        let string = String(cString: data)
        guard TerminalClipboardWritePolicy.shouldWrite(string, to: kind) else {
            TerminalDebugLog.log(
                .input,
                "clipboard write skipped empty kind=\(kind.debugLabel)"
            )
            return
        }

        #if canImport(UIKit)
            switch kind {
            case .standard:
                UIPasteboard.general.string = string
            case .selection:
                UIPasteboard.pierTerminalSelection?.string = string
            }
        #elseif canImport(AppKit)
            let pasteboard = NSPasteboard.pierTerminal(for: kind)
            pasteboard.clearContents()
            pasteboard.setString(string, forType: .string)
        #endif
        TerminalDebugLog.log(
            .input,
            "clipboard write kind=\(kind.debugLabel) bytes=\(string.utf8.count) lines=\(TerminalInputText.lineCount(in: string))"
        )
    }

    static func readClipboard(
        userdata: UnsafeMutableRawPointer?,
        clipboard: ghostty_clipboard_e,
        opaquePtr: UnsafeMutableRawPointer?
    ) -> Bool {
        guard let userdata, let opaquePtr else { return false }

        let bridge = Unmanaged<TerminalCallbackBridge>
            .fromOpaque(userdata)
            .takeUnretainedValue()
        guard let surface = bridge.rawSurface else { return false }
        guard let kind = TerminalClipboardKind(clipboard) else {
            TerminalDebugLog.log(
                .input,
                "clipboard read dropped unsupported kind raw=\(clipboard.rawValue)"
            )
            return false
        }

        #if canImport(UIKit)
            let string: String?
            switch kind {
            case .standard:
                string = UIPasteboard.general.string
                    .flatMap { $0.isEmpty ? nil : $0 }
            case .selection:
                let raw = UIPasteboard.pierTerminalSelection?.string
                string = raw.flatMap { $0.isEmpty ? nil : $0 }
            }
        #elseif canImport(AppKit)
            let string: String?
            switch kind {
            case .standard:
                // Image fallback is standard-paste only: screenshots land on
                // the system pasteboard, never on the private selection one.
                let pasteboard = NSPasteboard.general
                string =
                    pasteboard.string(forType: .string).flatMap { $0.isEmpty ? nil : $0 }
                    ?? terminalPasteImagePathFromPasteboard(pasteboard)
            case .selection:
                string = NSPasteboard.pierTerminalSelection
                    .string(forType: .string)
                    .flatMap { $0.isEmpty ? nil : $0 }
            }
        #endif

        guard let string else {
            TerminalDebugLog.log(
                .input,
                "clipboard paste read empty kind=\(kind.debugLabel)"
            )
            return false
        }
        TerminalDebugLog.log(
            .input,
            "clipboard paste read bytes=\(string.utf8.count) lines=\(TerminalInputText.lineCount(in: string))"
        )
        string.withCString { cString in
            ghostty_surface_complete_clipboard_request(surface, cString, opaquePtr, false)
        }
        TerminalDebugLog.log(.input, "clipboard paste complete")
        return true
    }

    static func confirmReadClipboard(
        userdata: UnsafeMutableRawPointer?,
        string: UnsafePointer<CChar>?,
        opaquePtr: UnsafeMutableRawPointer?,
        request: ghostty_clipboard_request_e
    ) {
        guard let userdata, let string, let opaquePtr else { return }

        let bridge = Unmanaged<TerminalCallbackBridge>
            .fromOpaque(userdata)
            .takeUnretainedValue()
        let text = String(cString: string)
        let kind = ClipboardConfirmRequest.Kind(request)
        TerminalDebugLog.log(
            .input,
            "clipboard paste confirm request=\(request.rawValue) bytes=\(text.utf8.count) lines=\(TerminalInputText.lineCount(in: text))"
        )
        let state = ClipboardConfirmState(opaquePtr)
        // Own opaquePtr before this callback returns (and before any hop)
        // so teardown cannot miss it. Adopt on main assigns pending; do
        // not present or complete here: libghostty is still on the stack
        // of the complete() that raised UnsafePaste.
        bridge.clipboardConfirmInFlight.store(state)
        terminalRunOnMainSync {
            bridge.adoptClipboardConfirmation(
                contents: text,
                kind: kind,
                state: state
            )
        }
        terminalRunOnMainAsync {
            bridge.presentClipboardConfirmIfNeeded()
        }
    }
}

func terminalControllerWakeupCallback(userdata: UnsafeMutableRawPointer?) {
    TerminalCallbacks.wakeup(userdata: userdata)
}

func terminalControllerActionCallback(
    appPtr: ghostty_app_t?,
    target: ghostty_target_s,
    action: ghostty_action_s
) -> Bool {
    TerminalCallbacks.action(appPtr: appPtr, target: target, action: action)
}

func terminalControllerCloseSurfaceCallback(
    userdata: UnsafeMutableRawPointer?,
    processAlive: Bool
) {
    TerminalCallbacks.closeSurface(userdata: userdata, processAlive: processAlive)
}

func terminalControllerWriteClipboardCallback(
    userdata: UnsafeMutableRawPointer?,
    clipboard: ghostty_clipboard_e,
    contents: UnsafePointer<ghostty_clipboard_content_s>?,
    contentsLen: Int,
    confirm: Bool
) {
    TerminalCallbacks.writeClipboard(
        userdata: userdata,
        clipboard: clipboard,
        contents: contents,
        contentsLen: contentsLen,
        confirm: confirm
    )
}

func terminalControllerReadClipboardCallback(
    userdata: UnsafeMutableRawPointer?,
    clipboard: ghostty_clipboard_e,
    opaquePtr: UnsafeMutableRawPointer?
) -> Bool {
    TerminalCallbacks.readClipboard(
        userdata: userdata,
        clipboard: clipboard,
        opaquePtr: opaquePtr
    )
}

func terminalControllerConfirmReadClipboardCallback(
    userdata: UnsafeMutableRawPointer?,
    string: UnsafePointer<CChar>?,
    opaquePtr: UnsafeMutableRawPointer?,
    request: ghostty_clipboard_request_e
) {
    TerminalCallbacks.confirmReadClipboard(
        userdata: userdata,
        string: string,
        opaquePtr: opaquePtr,
        request: request
    )
}
