import Foundation

/// Whether the host should steal a terminal click from a mouse-reporting TUI.
/// Opening still goes through Ghostty `OPEN_URL` → Pier Files / openExternal.
public enum HostLinkClick {
    private static let consumeSchemes: Set<String> = [
        "file",
        "http",
        "https",
        "mailto",
        "pier",
    ]
    private static let rejectSchemes: Set<String> = [
        "javascript",
        "data",
        "vbscript",
        "vscode",
        "cursor",
        "zed",
        "idea",
    ]

    public static func shouldConsume(_ url: String) -> Bool {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return false
        }
        if let scheme = scheme(of: trimmed) {
            if rejectSchemes.contains(scheme) {
                return false
            }
            return consumeSchemes.contains(scheme)
        }
        return looksLikePath(trimmed)
    }

    private static func scheme(of value: String) -> String? {
        guard let match = value.range(
            of: "^[a-z][a-z0-9+.-]*:",
            options: [.regularExpression, .caseInsensitive]
        ) else {
            return nil
        }
        let raw = value[match].dropLast()
        return String(raw).lowercased()
    }

    private static func looksLikePath(_ value: String) -> Bool {
        value.hasPrefix("/")
            || value.hasPrefix("~/")
            || value.hasPrefix("./")
            || value.hasPrefix("../")
            || value.contains("/")
            || value.contains("\\")
    }
}
