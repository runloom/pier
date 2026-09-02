//
//  ClipboardRouting.swift
//  libghostty-spm
//
//  Routes Ghostty clipboard kinds onto host pasteboards, mirroring
//  Ghostty.app: only the standard clipboard touches the system pasteboard;
//  the selection clipboard (copy-on-select, middle-click paste, OSC 52 "s")
//  lives on a private named pasteboard. Without this split, every incidental
//  drag-selection in any terminal clobbers the user's system clipboard —
//  and a blank-region selection (trimmed to "") silently wipes it.
//

import Foundation
import GhosttyKit

#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

enum TerminalClipboardKind: Equatable {
    case standard
    case selection

    /// Fails closed for kinds Pier cannot route. The C header only names
    /// STANDARD and SELECTION, but zig-side `apprt.Clipboard` also has
    /// `primary = 2` (OSC 52 "p"), which arrives here as a raw value.
    /// Ghostty.app equally refuses unknown kinds (`NSPasteboard.ghostty(_:)`
    /// returns nil) — never fall back to the system pasteboard.
    init?(_ raw: ghostty_clipboard_e) {
        switch raw {
        case GHOSTTY_CLIPBOARD_STANDARD:
            self = .standard
        case GHOSTTY_CLIPBOARD_SELECTION:
            self = .selection
        default:
            return nil
        }
    }

    var debugLabel: String {
        switch self {
        case .standard:
            return "standard"
        case .selection:
            return "selection"
        }
    }
}

/// Empty-write guard for the SYSTEM pasteboard only. Writing "" leaves an
/// empty string flavor behind, which the read side treats as "no content" —
/// a blank-region copy-on-select or an OSC 52 clear must not wipe the user's
/// clipboard. The private selection pasteboard accepts empty writes so a
/// blank selection also clears stale middle-click content (matches
/// Ghostty.app, which writes "" through for the selection kind).
enum TerminalClipboardWritePolicy {
    static func shouldWrite(_ string: String, to kind: TerminalClipboardKind) -> Bool {
        kind == .selection || !string.isEmpty
    }
}

#if canImport(UIKit)
    extension UIPasteboard {
        /// Private pasteboard backing Ghostty's selection clipboard.
        static var pierTerminalSelection: UIPasteboard? {
            UIPasteboard(
                name: UIPasteboard.Name("io.pier.app.terminal.selection"),
                create: true
            )
        }
    }
#elseif canImport(AppKit)
    extension NSPasteboard {
        /// Private pasteboard backing Ghostty's selection clipboard
        /// (mirrors Ghostty.app's `com.mitchellh.ghostty.selection`).
        /// Computed (not stored) so the non-Sendable wrapper never becomes
        /// a shared global; the pasteboard state itself lives in the system
        /// pasteboard server keyed by name.
        static var pierTerminalSelection: NSPasteboard {
            NSPasteboard(name: .init("io.pier.app.terminal.selection"))
        }

        /// Pasteboard for a Ghostty clipboard kind. Only `.standard`
        /// resolves to the system pasteboard.
        static func pierTerminal(for kind: TerminalClipboardKind) -> NSPasteboard {
            switch kind {
            case .standard:
                return .general
            case .selection:
                return .pierTerminalSelection
            }
        }
    }
#endif
