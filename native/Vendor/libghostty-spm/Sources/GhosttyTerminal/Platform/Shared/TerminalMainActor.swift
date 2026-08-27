import Foundation

@inline(__always)
func terminalRunOnMain(
    _ operation: @escaping @MainActor () -> Void
) {
    if Thread.isMainThread {
        MainActor.assumeIsolated {
            operation()
        }
        return
    }

    DispatchQueue.main.async {
        MainActor.assumeIsolated {
            operation()
        }
    }
}

/// Always hop to the next main-queue turn. Use when the caller is still
/// inside a libghostty C callback that must return before host UI or
/// `complete_clipboard_request` runs.
@inline(__always)
func terminalRunOnMainAsync(
    _ operation: @escaping @MainActor () -> Void
) {
    DispatchQueue.main.async {
        MainActor.assumeIsolated {
            operation()
        }
    }
}

/// Run on the main actor before returning. Use to attach libghostty-owned
/// state (clipboard pending) so teardown cannot miss it. Never present UI
/// or `complete_clipboard_request` here — that still hops with
/// `terminalRunOnMainAsync`.
@inline(__always)
func terminalRunOnMainSync(
    _ operation: @escaping @MainActor () -> Void
) {
    if Thread.isMainThread {
        MainActor.assumeIsolated {
            operation()
        }
        return
    }

    DispatchQueue.main.sync {
        MainActor.assumeIsolated {
            operation()
        }
    }
}
