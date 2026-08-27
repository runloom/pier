//
//  ClipboardConfirmHost.swift
//  libghostty-spm
//
//  Per-surface pending clipboard confirmation. confirm_read_clipboard
//  stores in-flight state before it returns; presentation and complete
//  hop off the libghostty stack. Complete always uses confirmed=true
//  (empty payload = cancel), matching Ghostty.app. Complete captures
//  the surface pointer while it is live — it does not go through
//  `[weak self]`.
//

import Foundation
import GhosttyKit

#if canImport(AppKit) && !canImport(UIKit)
    import AppKit
#endif

extension TerminalCallbackBridge {
    func adoptClipboardConfirmation(
        contents: String,
        kind: ClipboardConfirmRequest.Kind,
        state: ClipboardConfirmState
    ) {
        guard let surface = rawSurface else {
            TerminalDebugLog.log(
                .input,
                "clipboard confirm adopted after surface teardown"
            )
            return
        }
        guard let opaquePtr = state.take() else { return }
        clipboardConfirmInFlight.clear()

        let targets = ClipboardConfirmTargets(
            surface: surface,
            opaquePtr: opaquePtr
        )
        let request = ClipboardConfirmRequest(
            contents: contents,
            kind: kind
        ) { payload in
            ClipboardConfirmCompletion.complete(
                surface: targets.surface,
                payload: payload,
                opaquePtr: targets.opaquePtr
            )
        }
        pendingClipboardConfirmation = request
    }

    func cancelPendingClipboardConfirmation() {
        pendingClipboardConfirmation?.cancel()
        pendingClipboardConfirmation = nil
        abortPresentedClipboardConfirmIfNeeded()
    }

    func completeInFlightClipboardConfirmIfNeeded() {
        guard let state = clipboardConfirmInFlight.take() else { return }
        guard let opaquePtr = state.take(), let surface = rawSurface else {
            TerminalDebugLog.log(
                .input,
                "clipboard confirm in-flight after surface teardown"
            )
            return
        }
        ClipboardConfirmCompletion.complete(
            surface: surface,
            payload: nil,
            opaquePtr: opaquePtr
        )
    }

    func clipboardConfirmationDidChange(
        from previous: ClipboardConfirmRequest?
    ) {
        guard previous !== pendingClipboardConfirmation else { return }
        previous?.cancel()
        if pendingClipboardConfirmation != nil {
            abortPresentedClipboardConfirmIfNeeded()
        }
    }

    func presentClipboardConfirmIfNeeded() {
        #if canImport(AppKit) && !canImport(UIKit)
            guard !isPresentingClipboardConfirm else { return }
            isPresentingClipboardConfirm = true
            defer { isPresentingClipboardConfirm = false }

            while let request = pendingClipboardConfirmation {
                let response = ClipboardConfirmAlert.run(
                    contents: request.contents,
                    kind: request.kind
                )
                switch ClipboardConfirmAlert.action(
                    pendingUnchanged: pendingClipboardConfirmation === request,
                    response: response
                ) {
                case .presentNext:
                    continue
                case .finishAccept:
                    finishPending(request, accept: true)
                case .finishCancel:
                    finishPending(request, accept: false)
                }
                break
            }
        #else
            guard let request = pendingClipboardConfirmation else { return }
            finishPending(request, accept: true)
        #endif
    }

    private func finishPending(
        _ request: ClipboardConfirmRequest,
        accept: Bool
    ) {
        guard pendingClipboardConfirmation === request else { return }
        if accept {
            request.complete()
        } else {
            request.cancel()
        }
        if pendingClipboardConfirmation === request {
            pendingClipboardConfirmation = nil
        }
    }

    private func abortPresentedClipboardConfirmIfNeeded() {
        #if canImport(AppKit) && !canImport(UIKit)
            guard isPresentingClipboardConfirm else { return }
            NSApp.abortModal()
        #endif
    }
}
