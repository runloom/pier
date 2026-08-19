@_spi(PierDiagnostics) @testable import GhosttyTerminal
import AppKit
import XCTest

/// Patch 0108 冒烟：运行时收缩 scrollback 上限不破坏终端（viewport 仍可读、
/// 后续输出仍推进）。页级内存回收语义由 zig 侧 PageList 守卫（复用 grow()
/// 的活动区保护），这里验证 ABI 通路与存活性。
@MainActor
final class TerminalScrollbackLimitTests: XCTestCase {
    func testLiveScrollbackShrinkKeepsTerminalUsable() async throws {
        let controller = TerminalController { builder in
            builder.withCursorStyleBlink(false)
        }
        let session = InMemoryTerminalSession(write: { _ in }, resize: { _ in })
        let view = TerminalView(frame: .zero)
        view.configuration = TerminalSurfaceOptions(backend: .inMemory(session))
        view.controller = controller
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 640, height: 400),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        defer { window.orderOut(nil) }
        view.frame = NSRect(x: 0, y: 0, width: 640, height: 400)
        try XCTUnwrap(window.contentView).addSubview(view)
        await settle()

        // 填充远超一页的滚动历史。
        for index in 0..<2000 {
            session.receive("pier-scrollback-line-\(index)\n")
        }
        let painted = await waitUntil {
            session.readViewportText()?.contains("pier-scrollback-line-1999")
                == true
        }
        XCTAssertTrue(painted)

        // 收缩到最小值再恢复：不崩、viewport 内容保留、新输出可见。
        view.setScrollbackLimit(0)
        await settle()
        view.setScrollbackLimit(64_000_000)
        session.receive("pier-after-shrink\n")
        let alive = await waitUntil {
            session.readViewportText()?.contains("pier-after-shrink") == true
        }
        XCTAssertTrue(alive)
    }

    private func settle() async {
        for _ in 0..<5 {
            await withCheckedContinuation { continuation in
                DispatchQueue.main.async { continuation.resume() }
            }
            try? await Task.sleep(for: .milliseconds(40))
        }
    }

    private func waitUntil(
        timeout: TimeInterval = 3,
        condition: @escaping @MainActor () -> Bool
    ) async -> Bool {
        let deadline = ProcessInfo.processInfo.systemUptime + timeout
        while ProcessInfo.processInfo.systemUptime < deadline {
            if condition() {
                return true
            }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return condition()
    }
}
