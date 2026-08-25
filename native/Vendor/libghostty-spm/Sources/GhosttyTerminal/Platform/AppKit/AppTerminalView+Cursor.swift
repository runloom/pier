//
//  AppTerminalView+Cursor.swift
//  libghostty-spm
//

#if canImport(AppKit) && !canImport(UIKit)
    import AppKit

    extension AppTerminalView {
        /// The grid keeps the system arrow (including the terminal-default
        /// `text` shape); only shapes the core explicitly requests for
        /// interaction — link hover, terminal-app requests — change it.
        /// Unknown shapes keep the current cursor (mirrors ghostty macOS).
        func applyCursor(for shape: TerminalMouseShape) {
            let cursor: NSCursor?
            switch shape {
            case .pointer: cursor = .pointingHand
            case .grab: cursor = .openHand
            case .grabbing: cursor = .closedHand
            case .crosshair: cursor = .crosshair
            case .contextMenu: cursor = .contextualMenu
            case .notAllowed: cursor = .operationNotAllowed
            case .resizeLeft: cursor = .resizeLeft
            case .resizeRight: cursor = .resizeRight
            case .resizeUp: cursor = .resizeUp
            case .resizeDown: cursor = .resizeDown
            case .resizeUpDown: cursor = .resizeUpDown
            case .resizeLeftRight: cursor = .resizeLeftRight
            case .arrow, .text, .verticalText: cursor = .arrow
            case .unknown: cursor = nil
            }
            cursor?.set()
        }

        override open func mouseEntered(with event: NSEvent) {
            // Re-send the current position: mouseExited set it to -1/-1 and
            // hover/link logic depends on the position being in the viewport
            // again before the first mouseMoved.
            let (x, y) = mousePoint(from: event)
            surface?.sendMousePos(
                x: x,
                y: y,
                mods: TerminalInputModifiers(from: event.modifierFlags).ghosttyMods
            )
        }

        override open func mouseExited(with event: NSEvent) {
            // Drag events keep arriving after the cursor leaves the viewport,
            // so clearing here would interrupt an active selection drag.
            guard NSEvent.pressedMouseButtons == 0 else { return }

            // Negative position tells the core the cursor left the viewport:
            // it clears link hover and emits a mouse_shape restore, which
            // routes back through `applyCursor` to the arrow.
            surface?.sendMousePos(
                x: -1,
                y: -1,
                mods: TerminalInputModifiers().ghosttyMods
            )
            NSCursor.arrow.set()
        }

        /// Core requested pointer visibility (mouse-hide-while-typing).
        func applyCursorVisibility(_ visible: Bool) {
            NSCursor.setHiddenUntilMouseMoves(!visible)
        }
    }
#endif
