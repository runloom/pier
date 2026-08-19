import Foundation
import GhosttyKit

/// 终端原始输出 → 分段 transcript 文件（历史三层化 Tier 2 的 native 写入端）。
///
/// 有界性契约（与主进程 `terminal-transcripts` 服务对齐）：
/// - tap 回调在 ghostty IO 线程持 renderer 锁触发：只拷贝字节入队并返回，
///   永不做 IO、永不阻塞 PTY 读；
/// - 每 surface 在途字节上限 4MB，超限丢弃并写缺口标记；
/// - 段文件 `NNNNNN.log` 上限 8MB 轮转；压缩由主进程冷段清扫承担；
/// - 目录布局 `{root}/{lifecycleId}/NNNNNN.log`，与主进程写入端同构。
enum TranscriptTapLimits {
    static let maxPendingBytes = 4 * 1024 * 1024
    static let maxSegmentBytes = 8 * 1024 * 1024
}

/// 单 surface 的 tap 上下文。Terminal 强引用本对象；setOutputTap 用
/// passUnretained。必须先摘 tap 再释放 Terminal，避免 IO 线程回调悬空。
final class TranscriptTapContext {
    private let directory: URL
    private let queue: DispatchQueue
    private let lock = NSLock()
    private var pendingBytes = 0
    private var droppedBytes = 0
    private var needsGapMarker = false
    private var handle: FileHandle?
    private var segmentIndex = 0
    private var segmentBytes = 0
    private var closed = false

    init(directory: URL, queue: DispatchQueue) {
        self.directory = directory
        self.queue = queue
    }

    /// IO 线程入口：拷贝已完成（Data 由调用方构造），这里只做入队判定。
    func enqueue(_ data: Data) {
        lock.lock()
        if closed {
            lock.unlock()
            return
        }
        if pendingBytes + data.count > TranscriptTapLimits.maxPendingBytes {
            droppedBytes += data.count
            needsGapMarker = true
            lock.unlock()
            return
        }
        pendingBytes += data.count
        var payload = data
        if needsGapMarker {
            needsGapMarker = false
            let marker = "\n[pier] transcript gap: \(droppedBytes) bytes dropped\n"
            payload = Data(marker.utf8) + data
        }
        lock.unlock()
        queue.async { [weak self] in
            self?.write(payload, accounted: data.count)
        }
    }

    /// 关闭写入（close 路径）。之后 enqueue 变 no-op；队列尾部收口文件句柄。
    func finish() {
        lock.lock()
        closed = true
        lock.unlock()
        queue.async { [self] in
            try? handle?.close()
            handle = nil
        }
    }

    private func write(_ data: Data, accounted: Int) {
        defer {
            lock.lock()
            pendingBytes -= accounted
            lock.unlock()
        }
        do {
            var remaining = data
            while !remaining.isEmpty {
                let file = try ensureHandle()
                let room = TranscriptTapLimits.maxSegmentBytes - segmentBytes
                let take = min(room, remaining.count)
                let chunk = remaining.prefix(take)
                try file.write(contentsOf: chunk)
                segmentBytes += take
                remaining = remaining.dropFirst(take)
                if segmentBytes >= TranscriptTapLimits.maxSegmentBytes {
                    try? file.close()
                    handle = nil
                }
            }
        } catch {
            // 写盘失败不影响终端：丢弃本批，等待下批重试建句柄。
            try? handle?.close()
            handle = nil
        }
    }

    private func ensureHandle() throws -> FileHandle {
        if let handle {
            return handle
        }
        let fm = FileManager.default
        try fm.createDirectory(at: directory, withIntermediateDirectories: true)
        if segmentIndex == 0 {
            // 续接既有目录（同 lifecycle 的 reload/重连）：从最大段号之后开始。
            let existing = (try? fm.contentsOfDirectory(atPath: directory.path)) ?? []
            let indices = existing.compactMap { name -> Int? in
                guard name.hasSuffix(".log") || name.hasSuffix(".log.gz") else {
                    return nil
                }
                return Int(name.prefix(6))
            }
            segmentIndex = indices.max() ?? 0
        }
        segmentIndex += 1
        segmentBytes = 0
        let name = String(format: "%06d.log", segmentIndex)
        let url = directory.appendingPathComponent(name)
        fm.createFile(atPath: url.path, contents: nil)
        let file = try FileHandle(forWritingTo: url)
        try file.seekToEnd()
        handle = file
        return file
    }
}

/// 全局 tap 写入端：串行写盘队列 + transcript 根目录。
enum TranscriptTapWriter {
    static let queue = DispatchQueue(
        label: "pier.terminal-transcripts",
        qos: .utility
    )
    private static let rootLock = NSLock()
    private static var rootDirectory: URL?

    static func setRoot(_ path: String) {
        rootLock.lock()
        rootDirectory = path.isEmpty ? nil : URL(fileURLWithPath: path)
        rootLock.unlock()
    }

    /// lifecycleId 目录名净化（与主进程服务同规则）。`.` / `..` 不能当目录名。
    static func sanitize(_ lifecycleId: String) -> String {
        let cleaned = String(
            lifecycleId.map { ch in
                if ch.isLetter && ch.isASCII { return ch }
                if ch.isNumber && ch.isASCII { return ch }
                if ch == "." || ch == "_" || ch == "-" { return ch }
                return "_"
            }
        )
        if cleaned.isEmpty {
            return "_empty"
        }
        if cleaned == "." || cleaned == ".." {
            return "_\(cleaned)"
        }
        return cleaned
    }

    static func makeContext(lifecycleId: String) -> TranscriptTapContext? {
        rootLock.lock()
        let root = rootDirectory
        rootLock.unlock()
        guard let root, !lifecycleId.isEmpty else {
            return nil
        }
        let dir = root.appendingPathComponent(sanitize(lifecycleId))
        return TranscriptTapContext(directory: dir, queue: queue)
    }
}

/// C tap 回调：ghostty IO 线程 → 拷贝字节 → 有界入队。
let pierTranscriptTapCallback: ghostty_surface_output_tap_cb = {
    userdata, bytes, length in
    guard let userdata, let bytes, length > 0 else { return }
    let context = Unmanaged<TranscriptTapContext>
        .fromOpaque(userdata)
        .takeUnretainedValue()
    context.enqueue(Data(bytes: bytes, count: Int(length)))
}
