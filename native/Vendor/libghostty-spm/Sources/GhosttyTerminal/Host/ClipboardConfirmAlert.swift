//
//  ClipboardConfirmAlert.swift
//  libghostty-spm
//
//  Pier host-copy NSAlert for clipboard confirmation. Product shell stays
//  NSAlert (ghostty-host-copy catalog); lifecycle is owned by
//  ClipboardConfirmRequest, not by runModal.
//

#if canImport(AppKit) && !canImport(UIKit)
    import AppKit

    enum ClipboardConfirmAlert {
        enum Response: Equatable, Sendable {
            case accept
            case cancel
            case aborted
        }

        enum Action: Equatable, Sendable {
            case finishAccept
            case finishCancel
            case presentNext
        }

        /// `.aborted` with the same pending request is cancel (teardown /
        /// replace that did not swap in a new prompt). Only a *new* pending
        /// request continues the present loop.
        static func action(
            pendingUnchanged: Bool,
            response: Response
        ) -> Action {
            guard pendingUnchanged else { return .presentNext }
            switch response {
            case .accept:
                return .finishAccept
            case .cancel, .aborted:
                return .finishCancel
            }
        }

        @MainActor
        static func run(contents: String, kind _: ClipboardConfirmRequest.Kind) -> Response {
            // Product copy is paste-protection only (ghostty-host-copy catalog).
            // OSC 52 kinds share this NSAlert until authorize-copy exists.
            let lineCount = TerminalInputText.lineCount(in: contents)
            let copy = TerminalHostCopy.pasteConfirm(lineCount: lineCount)
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = copy.title
            alert.informativeText = copy.body
            alert.addButton(withTitle: copy.accept)
            alert.addButton(withTitle: copy.cancel)
            switch alert.runModal() {
            case .alertFirstButtonReturn:
                return .accept
            case .abort:
                return .aborted
            default:
                return .cancel
            }
        }
    }
#endif
