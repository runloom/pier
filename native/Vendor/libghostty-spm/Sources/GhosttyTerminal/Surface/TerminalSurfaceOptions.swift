//
//  TerminalSurfaceOptions.swift
//  libghostty-spm
//
//  Created by Lakr233 on 2026/3/16.
//

import GhosttyKit

public struct TerminalSurfaceOptions: Sendable {
    public var backend: TerminalSessionBackend
    public var fontSize: Float?
    public var workingDirectory: String?
    public var context: TerminalSurfaceContext

    public init(
        backend: TerminalSessionBackend = .exec,
        fontSize: Float? = nil,
        workingDirectory: String? = nil,
        context: TerminalSurfaceContext = .window
    ) {
        self.backend = backend
        self.fontSize = fontSize
        self.workingDirectory = workingDirectory
        self.context = context
    }

    func isEquivalent(to other: TerminalSurfaceOptions) -> Bool {
        fontSize == other.fontSize
            && workingDirectory == other.workingDirectory
            && context == other.context
            && backend.isEquivalent(to: other.backend)
    }

    var inMemorySession: InMemoryTerminalSession? {
        guard case let .inMemory(session) = backend else { return nil }
        return session
    }
}
