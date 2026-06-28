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

private enum TerminalCallbacks {
    #if canImport(AppKit)
        private static let terminalPasteImageDirectoryName = "pier-terminal-pastes"
        private static let terminalPasteImageRetentionInterval: TimeInterval = 24 * 60 * 60

        static func confirmUnsafePaste(text: String) -> Bool {
            if Thread.isMainThread {
                return MainActor.assumeIsolated {
                    runUnsafePasteAlert(text: text)
                }
            }
            return DispatchQueue.main.sync {
                MainActor.assumeIsolated {
                    runUnsafePasteAlert(text: text)
                }
            }
        }

        @MainActor
        private static func runUnsafePasteAlert(text: String) -> Bool {
            let lineCount = TerminalInputText.lineCount(in: text)
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = "确认粘贴到终端？"
            alert.informativeText =
                "这段内容包含 \(lineCount) 行，可能会直接执行命令。"
            alert.addButton(withTitle: "粘贴")
            alert.addButton(withTitle: "取消")
            return alert.runModal() == .alertFirstButtonReturn
        }

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
    #else
        static func confirmUnsafePaste(text _: String) -> Bool {
            true
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
        guard let appPtr else { return false }
        guard ghostty_app_userdata(appPtr) != nil else { return false }
        guard target.tag == GHOSTTY_TARGET_SURFACE else { return false }
        guard let surfacePtr = target.target.surface else { return false }
        guard let bridgePtr = ghostty_surface_userdata(surfacePtr) else { return false }

        let bridge = Unmanaged<TerminalCallbackBridge>
            .fromOpaque(bridgePtr)
            .takeUnretainedValue()
        terminalRunOnMain {
            bridge.handleAction(action)
        }

        return false
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
        clipboard _: ghostty_clipboard_e,
        contents: UnsafePointer<ghostty_clipboard_content_s>?,
        contentsLen: Int,
        confirm _: Bool
    ) {
        guard contentsLen > 0 else { return }
        guard let content = contents?.pointee else { return }
        guard let data = content.data else { return }
        let string = String(cString: data)

        #if canImport(UIKit)
            UIPasteboard.general.string = string
        #elseif canImport(AppKit)
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(string, forType: .string)
        #endif
    }

    static func readClipboard(
        userdata: UnsafeMutableRawPointer?,
        clipboard _: ghostty_clipboard_e,
        opaquePtr: UnsafeMutableRawPointer?
    ) -> Bool {
        guard let userdata, let opaquePtr else { return false }

        let bridge = Unmanaged<TerminalCallbackBridge>
            .fromOpaque(userdata)
            .takeUnretainedValue()
        guard let surface = bridge.rawSurface else { return false }

        #if canImport(UIKit)
            let string = UIPasteboard.general.string
        #elseif canImport(AppKit)
            let pasteboard = NSPasteboard.general
            let string =
                pasteboard.string(forType: .string).flatMap { $0.isEmpty ? nil : $0 }
                ?? terminalPasteImagePathFromPasteboard(pasteboard)
        #endif

        guard let string else {
            TerminalDebugLog.log(.input, "clipboard paste read empty")
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
        guard let surface = bridge.rawSurface else { return }

        let text = String(cString: string)
        TerminalDebugLog.log(
            .input,
            "clipboard paste confirm request=\(request.rawValue) bytes=\(text.utf8.count) lines=\(TerminalInputText.lineCount(in: text))"
        )

        let confirmed = confirmUnsafePaste(text: text)
        text.withCString { cString in
            ghostty_surface_complete_clipboard_request(
                surface,
                cString,
                opaquePtr,
                confirmed
            )
        }
        TerminalDebugLog.log(
            .input,
            confirmed ? "clipboard paste confirmed" : "clipboard paste canceled"
        )
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
