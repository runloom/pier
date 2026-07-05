@testable import GhosttyBridge
import GhosttyTerminal
import XCTest

final class TerminalDefaultAppearanceConfigTests: XCTestCase {
    func testDefaultAppearanceDisablesShellIntegrationCursorOverride() {
        let configLines = defaultAppearanceConfigLines()
        let features = configValue("shell-integration-features", in: configLines)

        XCTAssertNotNil(
            features,
            "Pier should configure Ghostty shell integration features. Rendered config:\n\(configLines.joined(separator: "\n"))"
        )
        XCTAssertTrue(
            features?.split(separator: ",").map(String.init).contains("no-cursor")
                == true,
            "Pier should let its cursor style settings control the visible default cursor instead of Ghostty shell integration hooks. Rendered config:\n\(configLines.joined(separator: "\n"))"
        )
    }

    func testDefaultAppearanceThickensBarAndUnderlineCursors() {
        let configLines = defaultAppearanceConfigLines()

        XCTAssertTrue(
            configLines.contains("adjust-cursor-thickness = 1"),
            "Bar cursors should be thickened from Ghostty's default geometry for readability. Rendered config:\n\(configLines.joined(separator: "\n"))"
        )
        XCTAssertTrue(
            configLines.contains("adjust-underline-thickness = 1"),
            "Underline cursors should be thickened from Ghostty's default geometry for readability. Rendered config:\n\(configLines.joined(separator: "\n"))"
        )
    }

    func testDefaultAppearanceDoesNotHardCodeCursorShape() {
        let configLines = defaultAppearanceConfigLines()

        XCTAssertFalse(
            configLines.contains { $0.hasPrefix("cursor-style = ") },
            "Cursor shape should flow through terminal runtime preferences, not default appearance config. Rendered config:\n\(configLines.joined(separator: "\n"))"
        )
        XCTAssertFalse(
            configLines.contains { $0.hasPrefix("cursor-style-blink = ") },
            "Cursor blink should flow through terminal runtime preferences, not default appearance config. Rendered config:\n\(configLines.joined(separator: "\n"))"
        )
    }

    private func defaultAppearanceConfigLines() -> [String] {
        TerminalConfiguration {
            GhosttyBridgeImpl.configureDefaultTerminalAppearance(&$0)
        }
        .rendered
        .split(separator: "\n")
        .map(String.init)
    }

    private func configValue(_ key: String, in lines: [String]) -> String? {
        let prefix = "\(key) = "
        guard let line = lines.first(where: { $0.hasPrefix(prefix) }) else {
            return nil
        }
        return String(line.dropFirst(prefix.count))
    }
}
