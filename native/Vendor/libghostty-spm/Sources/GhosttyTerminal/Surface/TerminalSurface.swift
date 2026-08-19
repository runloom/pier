//
//  TerminalSurface.swift
//  libghostty-spm
//
//  Created by Lakr233 on 2026/3/16.
//

import Foundation
import GhosttyKit

/// Thread-safe wrapper around `ghostty_surface_t`.
///
/// All access must happen on the main actor. The surface should be freed
/// explicitly via ``free()`` before the wrapper is deallocated; `deinit`
/// includes a safety net but relying on it is discouraged.
@MainActor
public final class TerminalSurface {
    private var surface: ghostty_surface_t?
    private var hasBeenFreed = false
    private var viewportTextCache = ViewportTextCache()
    private var occlusionVisible = true
    private var lastPixelWidth: UInt32?
    private var lastPixelHeight: UInt32?
    private var lastScaleX: Double?
    private var lastScaleY: Double?

    init(_ surface: ghostty_surface_t) {
        self.surface = surface
    }

    var rawValue: ghostty_surface_t? {
        surface
    }

    // MARK: - Input

    @discardableResult
    func sendKeyEvent(_ event: ghostty_input_key_s) -> Bool {
        guard let s = surface else {
            TerminalDebugLog.log(.input, "surface key ignored: missing surface")
            return false
        }
        let result = ghostty_surface_key(s, event)
        TerminalDebugLog.log(
            .input,
            "surface key action=\(TerminalDebugLog.describe(event.action)) keycode=\(event.keycode) mods=0x\(String(event.mods.rawValue, radix: 16)) consumed=0x\(String(event.consumed_mods.rawValue, radix: 16)) text=\(terminalKeyText(event)) composing=\(event.composing) result=\(result)"
        )
        return result
    }

    @discardableResult
    public func sendText(_ text: String) -> Bool {
        sendText(Data(text.utf8))
    }

    /// Inject UTF-8 bytes from the host (N-API) without a Swift String round-trip.
    /// Length is the byte count of `data`, matching `ghostty_surface_text`.
    /// Returns false when the surface is missing or the buffer cannot be read.
    @discardableResult
    public func sendText(_ data: Data) -> Bool {
        guard let s = surface else {
            TerminalDebugLog.log(.input, "surface text ignored: missing surface")
            return false
        }
        if data.isEmpty {
            return true
        }
        TerminalDebugLog.log(
            .input,
            "surface text=\(TerminalDebugLog.describe(data))"
        )
        let result = feedUtf8(data) { base, count in
            ghostty_surface_text(s, base, count)
            return true
        }
        if result {
            noteViewportChanged()
        }
        return result
    }

    /// Copy `data` to a C pointer + byte count. False if the buffer has no base.
    private func feedUtf8(
        _ data: Data,
        _ body: (UnsafePointer<CChar>, UInt) -> Bool
    ) -> Bool {
        var invoked = false
        var result = false
        data.withUnsafeBytes { raw in
            guard let base = raw.baseAddress?.assumingMemoryBound(to: CChar.self) else {
                return
            }
            result = body(base, UInt(data.count))
            invoked = true
        }
        return invoked && result
    }

    @discardableResult
    func sendMouseButton(
        state: ghostty_input_mouse_state_e,
        button: ghostty_input_mouse_button_e,
        mods: ghostty_input_mods_e
    ) -> Bool {
        guard let s = surface else {
            TerminalDebugLog.log(.input, "surface mouse button ignored: missing surface")
            return false
        }
        let result = ghostty_surface_mouse_button(s, state, button, mods)
        TerminalDebugLog.log(
            .input,
            "surface mouseButton state=\(TerminalDebugLog.describe(state)) button=\(button.rawValue) mods=0x\(String(mods.rawValue, radix: 16)) result=\(result)"
        )
        return result
    }

    func sendMousePos(x: Double, y: Double, mods: ghostty_input_mods_e) {
        guard let s = surface else {
            TerminalDebugLog.log(.input, "surface mouse position ignored: missing surface")
            return
        }
        TerminalDebugLog.log(
            .input,
            "surface mousePos x=\(String(format: "%.2f", x)) y=\(String(format: "%.2f", y)) mods=0x\(String(mods.rawValue, radix: 16))"
        )
        ghostty_surface_mouse_pos(s, x, y, mods)
    }

    func sendMouseScroll(x: Double, y: Double, mods: ghostty_input_scroll_mods_t) {
        guard let s = surface else {
            TerminalDebugLog.log(.input, "surface scroll ignored: missing surface")
            return
        }
        TerminalDebugLog.log(
            .input,
            "surface scroll x=\(String(format: "%.2f", x)) y=\(String(format: "%.2f", y)) mods=0x\(String(mods, radix: 16))"
        )
        ghostty_surface_mouse_scroll(s, x, y, mods)
    }

    func preedit(_ text: String) {
        guard let s = surface else {
            TerminalDebugLog.log(.ime, "surface preedit ignored: missing surface")
            return
        }
        let data = Data(text.utf8)
        TerminalDebugLog.log(.ime, "surface preedit=\(TerminalDebugLog.describe(data))")
        // Ghostty treats length 0 as "clear IME overlay". Empty `Data` has
        // no baseAddress, so this must not go through `feedUtf8`.
        if data.isEmpty {
            ghostty_surface_preedit(s, nil, 0)
            noteViewportChanged()
            return
        }
        _ = feedUtf8(data) { base, count in
            ghostty_surface_preedit(s, base, count)
            return true
        }
        noteViewportChanged()
    }

    // MARK: - Actions

    @discardableResult
    func performBindingAction(_ action: String) -> Bool {
        guard let s = surface else {
            TerminalDebugLog.log(.actions, "binding action ignored: missing surface")
            return false
        }
        let data = Data(action.utf8)
        if data.isEmpty {
            return false
        }
        let result = feedUtf8(data) { base, count in
            ghostty_surface_binding_action(s, base, count)
        }
        TerminalDebugLog.log(
            .actions,
            "binding action=\(TerminalDebugLog.describe(action)) result=\(result)"
        )
        return result
    }

    // MARK: - Rendering

    func draw() {
        guard let s = surface else { return }
        TerminalDebugLog.log(.render, "surface draw")
        ghostty_surface_draw(s)
    }

    func refresh() {
        guard let s = surface else { return }
        TerminalDebugLog.log(.render, "surface refresh")
        ghostty_surface_refresh(s)
    }

    func setSize(width: UInt32, height: UInt32) {
        guard let s = surface else {
            TerminalDebugLog.log(.metrics, "surface setSize ignored: missing surface")
            return
        }
        TerminalDebugLog.log(.metrics, "surface setSize \(width)x\(height)")
        ghostty_surface_set_size(s, width, height)
        if lastPixelWidth != width || lastPixelHeight != height {
            lastPixelWidth = width
            lastPixelHeight = height
            noteViewportChanged()
        }
    }

    func setContentScale(x: Double, y: Double) {
        guard let s = surface else {
            TerminalDebugLog.log(.metrics, "surface contentScale ignored: missing surface")
            return
        }
        TerminalDebugLog.log(
            .metrics,
            "surface contentScale x=\(String(format: "%.2f", x)) y=\(String(format: "%.2f", y))"
        )
        ghostty_surface_set_content_scale(s, x, y)
        if lastScaleX != x || lastScaleY != y {
            lastScaleX = x
            lastScaleY = y
            noteViewportChanged()
        }
    }

    // MARK: - State

    /// 应用请求的 DECTCEM(?25) 光标模式位（TUI 输入聚焦探针）。
    /// 与 host cursor suppress 正交：读的是 VT 模式位，不是渲染结果。
    /// inner surface 已释放返回 nil——「读不到」不得被下游当作「失焦」。
    func cursorVisible() -> Bool? {
        guard let s = surface else { return nil }
        return ghostty_surface_cursor_visible(s)
    }

    func setFocus(_ focused: Bool) {
        guard let s = surface else { return }
        TerminalDebugLog.log(.lifecycle, "surface focus=\(focused)")
        ghostty_surface_set_focus(s, focused)
    }

    func setColorScheme(_ scheme: ghostty_color_scheme_e) {
        guard let s = surface else { return }
        TerminalDebugLog.log(.lifecycle, "surface colorScheme=\(scheme.rawValue)")
        ghostty_surface_set_color_scheme(s, scheme)
    }

    func setOcclusion(_ visible: Bool) {
        guard let s = surface else { return }
        TerminalDebugLog.log(.lifecycle, "surface occlusion visible=\(visible)")
        ghostty_surface_set_occlusion(s, visible)
        if occlusionVisible != visible {
            occlusionVisible = visible
            noteViewportChanged()
        }
    }

    /// Host-forced cursor suppression: renderer never draws the cursor
    /// glyph while set, regardless of terminal mode (DECTCEM) or focus.
    /// Pier patch 0103 adds this C API.
    func setCursorSuppress(_ suppressed: Bool) {
        guard let s = surface else { return }
        TerminalDebugLog.log(.lifecycle, "surface cursorSuppress=\(suppressed)")
        ghostty_surface_set_cursor_suppress(s, suppressed)
    }

    /// Feed bytes into the terminal's VT parser as if the child wrote them
    /// (does **not** send to the PTY). Used for host-driven mode changes such
    /// as DECTCEM cursor hide while a web overlay owns the keyboard.
    func writeOutput(_ data: Data) {
        guard let s = surface, !data.isEmpty else { return }
        data.withUnsafeBytes { raw in
            guard let base = raw.bindMemory(to: UInt8.self).baseAddress else {
                return
            }
            ghostty_surface_write_buffer(s, base, UInt(data.count))
        }
        noteViewportChanged()
    }

    // MARK: - Size Query

    func size() -> TerminalGridMetrics? {
        guard let s = surface else {
            TerminalDebugLog.log(.metrics, "surface size query ignored: missing surface")
            return nil
        }
        let metrics = TerminalGridMetrics(ghostty_surface_size(s))
        TerminalDebugLog.log(.metrics, "surface size \(metrics.debugSummary)")
        return metrics
    }

    // MARK: - Selection

    struct SelectionResult {
        let text: String
        let offsetStart: UInt32
        let offsetLength: UInt32
    }

    func hasSelection() -> Bool {
        guard let s = surface else {
            TerminalDebugLog.log(.input, "surface selection query ignored: missing surface")
            return false
        }
        let result = ghostty_surface_has_selection(s)
        TerminalDebugLog.log(.input, "surface hasSelection=\(result)")
        return result
    }

    func readSelection() -> String? {
        readSelectionResult()?.text
    }

    /// Current viewport text only (no scrollback). Empty viewport → "".
    func readViewportText() -> String? {
        guard let s = surface else {
            TerminalDebugLog.log(.input, "surface readViewportText ignored: missing surface")
            return nil
        }
        let dump = { () -> String? in
            let text = GhosttyText.readViewport(from: s)
            if text == nil {
                TerminalDebugLog.log(.input, "surface readViewportText returned false")
            }
            return text
        }
        if occlusionVisible {
            return viewportTextCache.read(dump: dump)
        }
        return viewportTextCache.readUncached(dump: dump)
    }

    func noteViewportChanged() {
        viewportTextCache.noteChanged()
    }

    @_spi(PierDiagnostics)
    public var viewportTextDumpCount: UInt64 { viewportTextCache.dumpCount }

    func readSelectionResult() -> SelectionResult? {
        guard let s = surface else {
            TerminalDebugLog.log(.input, "surface readSelection ignored: missing surface")
            return nil
        }
        var out = ghostty_text_s()
        guard ghostty_surface_read_selection(s, &out) else {
            TerminalDebugLog.log(.input, "surface readSelection returned false")
            return nil
        }
        defer { ghostty_surface_free_text(s, &out) }

        let text = GhosttyText.decode(out)
        guard !text.isEmpty else {
            TerminalDebugLog.log(.input, "surface readSelection empty")
            return SelectionResult(
                text: "",
                offsetStart: out.offset_start,
                offsetLength: out.offset_len
            )
        }
        TerminalDebugLog.log(
            .input,
            "surface readSelection bytes=\(text.utf8.count) lines=\(TerminalInputText.lineCount(in: text)) offset=\(out.offset_start)+\(out.offset_len)"
        )
        return SelectionResult(
            text: text,
            offsetStart: out.offset_start,
            offsetLength: out.offset_len
        )
    }

    // MARK: - IME

    func imePoint() -> (x: Double, y: Double, width: Double, height: Double) {
        var x: Double = 0
        var y: Double = 0
        var w: Double = 0
        var h: Double = 0
        if let s = surface {
            ghostty_surface_ime_point(s, &x, &y, &w, &h)
        }
        TerminalDebugLog.log(
            .ime,
            "surface imePoint x=\(String(format: "%.2f", x)) y=\(String(format: "%.2f", y)) width=\(String(format: "%.2f", w)) height=\(String(format: "%.2f", h))"
        )
        return (x, y, w, h)
    }

    // MARK: - Mouse Capture

    var isMouseCaptured: Bool {
        guard let s = surface else { return false }
        return ghostty_surface_mouse_captured(s)
    }

    // MARK: - Quicklook Word (Apple-only)

    #if canImport(UIKit) || canImport(AppKit)
        struct QuicklookWordResult {
            let word: String
            let offsetStart: UInt32
            let offsetLength: UInt32
            // tl_px_x / tl_px_y are reported in host points (view coordinates),
            // not surface pixels. Ghostty's embedded API receives mouse_pos in
            // points and stores the cursor position * contentScale internally,
            // then divides by contentScale when reporting selection coordinates
            // back. Callers must convert cell pixel dimensions to points before
            // dividing.
            let pointX: Double
            let pointY: Double
        }

        func quicklookWord() -> QuicklookWordResult? {
            guard let s = surface else {
                TerminalDebugLog.log(.input, "surface quicklookWord ignored: missing surface")
                return nil
            }
            var out = ghostty_text_s()
            guard ghostty_surface_quicklook_word(s, &out) else {
                TerminalDebugLog.log(.input, "surface quicklookWord returned false")
                return nil
            }
            defer { ghostty_surface_free_text(s, &out) }

            let word = GhosttyText.decode(out)
            TerminalDebugLog.log(
                .input,
                "surface quicklookWord word=\(TerminalDebugLog.describe(word)) offset=\(out.offset_start)+\(out.offset_len) pointX=\(String(format: "%.2f", out.tl_px_x)) pointY=\(String(format: "%.2f", out.tl_px_y))"
            )
            return QuicklookWordResult(
                word: word,
                offsetStart: out.offset_start,
                offsetLength: out.offset_len,
                pointX: out.tl_px_x,
                pointY: out.tl_px_y
            )
        }

        func selectionContainsQuicklookWord() -> Bool {
            guard let selected = readSelectionResult(),
                  let word = quicklookWord(),
                  !word.word.isEmpty,
                  word.offsetLength > 0
            else { return false }

            let selectionStart = UInt64(selected.offsetStart)
            let selectionEnd = selectionStart + UInt64(selected.offsetLength)
            let wordStart = UInt64(word.offsetStart)
            let wordEnd = wordStart + UInt64(word.offsetLength)
            let contains = wordStart >= selectionStart && wordEnd <= selectionEnd
            TerminalDebugLog.log(
                .input,
                "surface selectionContainsQuicklookWord=\(contains) selection=\(selected.offsetStart)+\(selected.offsetLength) word=\(word.offsetStart)+\(word.offsetLength)"
            )
            return contains
        }
    #endif

    // MARK: - Lifecycle

    func free() {
        guard !hasBeenFreed, let s = surface else { return }
        TerminalDebugLog.log(.lifecycle, "surface free")
        hasBeenFreed = true
        viewportTextCache.clear()
        occlusionVisible = true
        lastPixelWidth = nil
        lastPixelHeight = nil
        lastScaleX = nil
        lastScaleY = nil
        surface = nil
        ghostty_surface_free(s)
    }

    deinit {
        // Surface should be freed explicitly via free() before deinit.
        // The deinit safety net is intentionally removed because
        // Swift 6 strict concurrency prevents accessing @MainActor
        // state from nonisolated deinit.
    }
}

private func terminalKeyText(_ event: ghostty_input_key_s) -> String {
    guard let text = event.text else { return "nil" }
    return TerminalDebugLog.describe(String(cString: text))
}
