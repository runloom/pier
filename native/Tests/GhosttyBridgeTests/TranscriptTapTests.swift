@testable import GhosttyBridge
@_spi(PierDiagnostics) @testable import GhosttyTerminal
import AppKit
import GhosttyKit
import XCTest

/// 输出 tap 收集器：C 回调不可捕获上下文，经 userdata 反查实例。
private final class TapCollector {
    private let lock = NSLock()
    private var buffer = Data()

    func append(_ data: Data) {
        lock.lock()
        buffer.append(data)
        lock.unlock()
    }

    var text: String {
        lock.lock()
        defer { lock.unlock() }
        return String(decoding: buffer, as: UTF8.self)
    }

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return buffer.count
    }
}

private let tapCollectorCallback: ghostty_surface_output_tap_cb = {
    userdata, bytes, length in
    guard let userdata, let bytes, length > 0 else { return }
    Unmanaged<TapCollector>
        .fromOpaque(userdata)
        .takeUnretainedValue()
        .append(Data(bytes: bytes, count: Int(length)))
}

@MainActor
final class TranscriptTapTests: XCTestCase {
    /// Patch 0107 端到端：processOutput 前向 tap 转发原始字节；clear 后停止。
    func testOutputTapReceivesRawBytesAndStopsAfterClear() async throws {
        let fixture = try makeFixture()
        defer { fixture.window.orderOut(nil) }
        await settleRendering()
        let collector = TapCollector()

        fixture.view.setOutputTap(
            tapCollectorCallback,
            userdata: Unmanaged.passUnretained(collector).toOpaque()
        )
        fixture.session.receive("pier-tap-payload\n")
        let received = await waitUntil {
            collector.text.contains("pier-tap-payload")
        }
        XCTAssertTrue(received)

        fixture.view.setOutputTap(nil, userdata: nil)
        let countAfterClear = collector.count
        fixture.session.receive("pier-tap-after-clear\n")
        await settleRendering()
        XCTAssertEqual(collector.count, countAfterClear)
        XCTAssertFalse(collector.text.contains("pier-tap-after-clear"))
    }

    /// TranscriptTapContext：分段轮转 + 有界队列（溢出写缺口标记）。
    func testTranscriptTapContextRotatesSegmentsAndKeepsGapMarkers() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pier-tap-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = DispatchQueue(label: "pier.test.transcripts")
        let context = TranscriptTapContext(
            directory: root.appendingPathComponent("run-x"),
            queue: queue
        )

        // 20 × 1MB（逐块排空，不触发 4MB 队列丢弃）> 8MB 段上限 → 轮转出多段。
        let chunk = Data(repeating: UInt8(ascii: "x"), count: 1024 * 1024)
        for _ in 0..<20 {
            context.enqueue(chunk)
            queue.sync {}
        }
        context.finish()
        queue.sync {}

        let files = try FileManager.default
            .contentsOfDirectory(atPath: root.appendingPathComponent("run-x").path)
            .filter { $0.hasSuffix(".log") }
            .sorted()
        XCTAssertGreaterThanOrEqual(files.count, 2)
        let firstAttributes = try FileManager.default.attributesOfItem(
            atPath: root.appendingPathComponent("run-x/\(files[0])").path
        )
        let firstSize = (firstAttributes[.size] as? Int) ?? 0
        XCTAssertLessThanOrEqual(firstSize, TranscriptTapLimits.maxSegmentBytes)
    }

    func testTranscriptTapWriterSanitizesLifecycleIds() {
        XCTAssertEqual(
            TranscriptTapWriter.sanitize("../escape/run:1"),
            ".._escape_run_1"
        )
        XCTAssertEqual(
            TranscriptTapWriter.sanitize("task-abc_1.log"),
            "task-abc_1.log"
        )
        XCTAssertEqual(TranscriptTapWriter.sanitize("."), "_.")
        XCTAssertEqual(TranscriptTapWriter.sanitize(".."), "_..")
        XCTAssertEqual(TranscriptTapWriter.sanitize(""), "_empty")
    }

    private func makeFixture(
        size: NSSize = NSSize(width: 640, height: 400)
    ) throws -> Fixture {
        let controller = TerminalController { builder in
            builder.withCursorStyleBlink(false)
        }
        let session = InMemoryTerminalSession(write: { _ in }, resize: { _ in })
        let view = TerminalView(frame: .zero)
        view.configuration = TerminalSurfaceOptions(backend: .inMemory(session))
        view.controller = controller
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        view.frame = NSRect(origin: .zero, size: size)
        try XCTUnwrap(window.contentView).addSubview(view)
        return Fixture(session: session, view: view, window: window)
    }

    private func settleRendering() async {
        for _ in 0..<5 {
            await drainMainQueue()
            try? await Task.sleep(for: .milliseconds(50))
        }
    }

    private func drainMainQueue() async {
        await withCheckedContinuation { continuation in
            DispatchQueue.main.async {
                continuation.resume()
            }
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

@MainActor
private struct Fixture {
    let session: InMemoryTerminalSession
    let view: TerminalView
    let window: NSWindow
}
