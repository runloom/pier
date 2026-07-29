//
//  TerminalHostCopy.swift
//  libghostty-spm
//
//  Localized host copy table for:
//  - paste confirm (NSAlert)
//  - Thread.zig startup-failure printString (via ghostty_host_messages_get)
//  - Surface.zig process-exit fallback only (action not consumed)
//  Process-exit main path: renderer injectDisplayText (final string; no i18n here).
//  Keys: `src/shared/contracts/ghostty-host-copy.ts` / `terminal.ghosttyHost.*`.
//

import Foundation

public enum TerminalHostCopy {
    /// Optional BCP-47 tag from the host app (e.g. "zh-CN", "en").
    nonisolated(unsafe) public static var languageOverride: String?

    /// Fully localized message table pushed from the renderer.
    /// Keys match GhosttyHostMessageKind / catalog i18n leaf names
    /// (e.g. "processExited", "ptyExhausted", "dismissAnyKey").
    nonisolated(unsafe) private static var catalog: [String: String] = [:]
    /// Stable CString storage for ghostty_host_messages_get (Thread.zig).
    nonisolated(unsafe) private static var cStringCache: [String: UnsafeMutablePointer<CChar>] = [:]
    private static let lock = NSLock()

    public static func setLanguageOverride(_ tag: String?) {
        let trimmed = tag?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        languageOverride = trimmed.isEmpty ? nil : trimmed
    }

    /// Replace the whole catalog (renderer re-pushes on language change).
    public static func setCatalog(_ messages: [String: String]) {
        lock.lock()
        defer { lock.unlock() }
        for (_, ptr) in cStringCache {
            free(ptr)
        }
        cStringCache = [:]
        catalog = messages
        for (key, value) in messages {
            if let ptr = strdup(value) {
                cStringCache[key] = ptr
            }
        }
    }

    public static func snapshotCatalog() -> [String: String] {
        lock.lock()
        defer { lock.unlock() }
        return catalog
    }

    /// Pointer valid until next `setCatalog` / set / clear.
    public static func cStringPointer(for key: String) -> UnsafePointer<CChar>? {
        lock.lock()
        defer { lock.unlock() }
        guard let ptr = cStringCache[key] else {
            return nil
        }
        return UnsafePointer(ptr)
    }

    public static func message(_ key: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        let value = catalog[key]
        if let value, !value.isEmpty {
            return value
        }
        return nil
    }

    /// Format catalog template replacing `{{name}}` placeholders.
    public static func message(
        _ key: String,
        replacing replacements: [String: String]
    ) -> String? {
        guard var text = message(key) else { return nil }
        for (name, value) in replacements {
            text = text.replacingOccurrences(of: "{{\(name)}}", with: value)
        }
        return text
    }

    private static var prefersChinese: Bool {
        if let override = languageOverride?.lowercased(), !override.isEmpty {
            return override.hasPrefix("zh")
        }
        let preferred = Locale.preferredLanguages.first?.lowercased() ?? "en"
        return preferred.hasPrefix("zh")
    }

    public struct PasteConfirm {
        public let title: String
        public let body: String
        public let accept: String
        public let cancel: String
    }

    public static func pasteConfirm(lineCount: Int) -> PasteConfirm {
        if let title = message("pasteConfirmTitle"),
           let bodyTemplate = message("pasteConfirmBody"),
           let accept = message("pasteConfirmAccept"),
           let cancel = message("pasteConfirmCancel")
        {
            let body = bodyTemplate.replacingOccurrences(
                of: "{{lines}}",
                with: String(lineCount)
            )
            return PasteConfirm(
                title: title,
                body: body,
                accept: accept,
                cancel: cancel
            )
        }
        // Fallback before renderer catalog is pushed.
        if prefersChinese {
            return PasteConfirm(
                title: "粘贴到终端？",
                body: "这段内容包含 \(lineCount) 行，可能会直接执行命令。",
                accept: "粘贴",
                cancel: "取消"
            )
        }
        return PasteConfirm(
            title: "Paste into the terminal?",
            body: "This paste has \(lineCount) lines and may run commands immediately.",
            accept: "Paste",
            cancel: "Cancel"
        )
    }
}
