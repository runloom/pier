//
//  AppTerminalView+PublicInput.swift
//  libghostty-spm
//
//  Public wrappers around `TerminalSurface` write paths so hosts can
//  inject bytes into the pty without reaching for internal API.
//

#if canImport(AppKit) && !canImport(UIKit)
    import AppKit
    import GhosttyKit

    extension AppTerminalView {
        /// Send raw UTF-8 text directly to the underlying pty (bypassing
        /// key translation). Use this for synthetic input like `\x1b[Z`
        /// (Shift+Tab / CSI Z) or multi-line paste-style injections.
        ///
        /// When the remote has bracketed paste (mode 2004) enabled, Ghostty
        /// wraps the payload in paste fenceposts — trailing `\r` inside the
        /// same call will **not** submit an agent/shell prompt. Use
        /// ``sendKeyPress(keycode:mods:text:)`` for Enter / Esc / Ctrl+C.
        /// Returns false when the surface has not been created yet.
        @discardableResult
        public func sendText(_ text: String) -> Bool {
            surface?.sendText(text) ?? false
        }

        /// Inject a synthetic key press+release (AppKit virtual keycode).
        /// Prefer this over ``sendText`` for control keys and Enter-to-submit
        /// after a paste-style text injection.
        ///
        /// Success is judged by the PRESS event only: Ghostty returns false
        /// for most RELEASE events (nothing is encoded to the pty), so the
        /// release is best-effort state hygiene, not part of the result.
        @discardableResult
        public func sendKeyPress(
            keycode: UInt32,
            mods: UInt32 = 0,
            text: String? = nil
        ) -> Bool {
            guard let surface else { return false }
            var press = ghostty_input_key_s()
            press.action = GHOSTTY_ACTION_PRESS
            press.keycode = keycode
            press.mods = ghostty_input_mods_e(rawValue: mods)
            press.composing = false
            let pressOk: Bool
            if let text, !text.isEmpty {
                pressOk = text.withCString { ptr in
                    press.text = ptr
                    return surface.sendKeyEvent(press)
                }
            } else {
                pressOk = surface.sendKeyEvent(press)
            }
            var release = ghostty_input_key_s()
            release.action = GHOSTTY_ACTION_RELEASE
            release.keycode = keycode
            release.mods = ghostty_input_mods_e(rawValue: mods)
            release.composing = false
            _ = surface.sendKeyEvent(release)
            return pressOk
        }

        /// Invoke a named Ghostty binding action (e.g. "copy_to_clipboard",
        /// "clear_screen"). Returns true when the action dispatched.
        @discardableResult
        public func performBindingAction(_ action: String) -> Bool {
            surface?.performBindingAction(action) ?? false
        }

        /// Read the current terminal selection without invoking copy actions or
        /// touching the system clipboard. Returns nil when no non-empty
        /// selection is available.
        public func readSelectionText() -> String? {
            guard let text = surface?.readSelection(), !text.isEmpty else {
                return nil
            }
            return text
        }
    }
#endif
