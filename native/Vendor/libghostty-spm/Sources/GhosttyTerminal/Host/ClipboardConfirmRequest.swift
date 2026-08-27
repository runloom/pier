//
//  ClipboardConfirmRequest.swift
//  libghostty-spm
//
//  One-shot libghostty clipboard confirmation (paste / OSC 52 read).
//  Mirrors Ghostty.ClipboardConfirmationRequest: the object owns callback
//  state until complete, cancel, or deinit. Dropping an unresolved request
//  schedules cancellation so raw libghostty state cannot leak.
//  confirm_read_clipboard stores in-flight state before it returns (sync
//  hop to main if needed); only presentation / complete hops off that
//  stack. Deinit cancel is deferred because complete must not re-enter
//  libghostty from the creating callback.
//

import Foundation
import GhosttyKit

/// libghostty clipboard `opaquePtr` stays valid until `complete()`. Crossing
/// onto the main actor is exclusive and intentional.
final class ClipboardConfirmState: @unchecked Sendable {
    let opaquePtr: UnsafeMutableRawPointer
    private let lock = NSLock()
    private var consumed = false

    init(_ opaquePtr: UnsafeMutableRawPointer) {
        self.opaquePtr = opaquePtr
    }

    var isConsumed: Bool {
        lock.lock()
        defer { lock.unlock() }
        return consumed
    }

    func take() -> UnsafeMutableRawPointer? {
        lock.lock()
        defer { lock.unlock() }
        guard !consumed else { return nil }
        consumed = true
        return opaquePtr
    }
}

/// Thread-safe slot so a PTY-thread confirm can own `opaquePtr` before the
/// main-actor hop, and teardown can complete that state while the surface
/// is still live.
final class ClipboardConfirmInFlightSlot: @unchecked Sendable {
    private let lock = NSLock()
    private var state: ClipboardConfirmState?

    func store(_ state: ClipboardConfirmState) {
        lock.lock()
        self.state = state
        lock.unlock()
    }

    func clear() {
        lock.lock()
        state = nil
        lock.unlock()
    }

    func take() -> ClipboardConfirmState? {
        lock.lock()
        defer { lock.unlock() }
        let current = state
        state = nil
        return current
    }
}

private final class ClipboardFinishBox: @unchecked Sendable {
    let body: (String?) -> Void

    init(_ body: @escaping (String?) -> Void) {
        self.body = body
    }

    func call(_ payload: String?) {
        body(payload)
    }
}

final class ClipboardConfirmTargets: @unchecked Sendable {
    let surface: ghostty_surface_t
    let opaquePtr: UnsafeMutableRawPointer

    init(surface: ghostty_surface_t, opaquePtr: UnsafeMutableRawPointer) {
        self.surface = surface
        self.opaquePtr = opaquePtr
    }
}

enum ClipboardConfirmCompletion {
    static func complete(
        surface: ghostty_surface_t,
        payload: String?,
        opaquePtr: UnsafeMutableRawPointer
    ) {
        let text = payload ?? ""
        text.withCString { cString in
            ghostty_surface_complete_clipboard_request(
                surface,
                cString,
                opaquePtr,
                true
            )
        }
        TerminalDebugLog.log(
            .input,
            payload == nil ? "clipboard paste canceled" : "clipboard paste confirmed"
        )
    }
}

final class ClipboardConfirmRequest {
    enum Kind: Equatable, Sendable {
        case paste
        case osc52Read
        case osc52Write

        init(_ request: ghostty_clipboard_request_e) {
            switch request {
            case GHOSTTY_CLIPBOARD_REQUEST_OSC_52_READ:
                self = .osc52Read
            case GHOSTTY_CLIPBOARD_REQUEST_OSC_52_WRITE:
                self = .osc52Write
            default:
                self = .paste
            }
        }
    }

    let contents: String
    let kind: Kind
    private var onFinish: ((String?) -> Void)?

    init(
        contents: String,
        kind: Kind,
        onFinish: @escaping (String?) -> Void
    ) {
        self.contents = contents
        self.kind = kind
        self.onFinish = onFinish
    }

    deinit {
        guard let onFinish else { return }
        self.onFinish = nil
        let box = ClipboardFinishBox(onFinish)
        DispatchQueue.main.async {
            box.call(nil)
        }
    }

    /// Complete using the displayed clipboard contents.
    func complete() {
        finish(contents)
    }

    /// Cancel without using the displayed clipboard contents.
    func cancel() {
        finish(nil)
    }

    private func finish(_ payload: String?) {
        guard let onFinish else { return }
        self.onFinish = nil
        onFinish(payload)
    }
}
