//
//  TerminalController+Surface.swift
//  libghostty-spm
//

import Foundation
import GhosttyKit

extension TerminalController {
    /// Creates a new Ghostty surface with the given configuration.
    ///
    /// The `platformSetup` closure lets the caller fill in
    /// platform-specific fields (`platform_tag`, `platform`, `scale_factor`)
    /// on the raw surface config struct before the surface is created.
    func createSurface(
        bridge: TerminalCallbackBridge,
        configuration: TerminalSurfaceOptions,
        platformSetup: (inout ghostty_surface_config_s) -> Void
    ) -> ghostty_surface_t? {
        guard let app else { return nil }

        var surfaceConfig = ghostty_surface_config_new()
        surfaceConfig.userdata = Unmanaged.passUnretained(bridge).toOpaque()
        surfaceConfig.context = configuration.context.ghosttyValue
        configureBackend(&surfaceConfig, from: configuration)

        if let fontSize = configuration.fontSize {
            surfaceConfig.font_size = fontSize
        }

        return finalizeSurface(
            app: app,
            bridge: bridge,
            configuration: configuration,
            config: &surfaceConfig,
            platformSetup: platformSetup
        )
    }

    func retain(_ bridge: TerminalCallbackBridge) {
        retainedBridges.append(bridge)
    }

    func remove(_ bridge: TerminalCallbackBridge) {
        retainedBridges.removeAll { $0 === bridge }
    }

    var retainedBridgeCount: Int {
        retainedBridges.count
    }

    private func configureBackend(
        _ config: inout ghostty_surface_config_s,
        from options: TerminalSurfaceOptions
    ) {
        guard case let .inMemory(session) = options.backend else {
            config.backend = GHOSTTY_SURFACE_IO_BACKEND_EXEC
            return
        }

        config.backend = GHOSTTY_SURFACE_IO_BACKEND_HOST_MANAGED
        config.receive_userdata = Unmanaged.passUnretained(session).toOpaque()
        config.receive_buffer = InMemoryTerminalSession.receiveBufferCallback
        config.receive_resize = InMemoryTerminalSession.receiveResizeCallback
    }

    private func finalizeSurface(
        app: ghostty_app_t,
        bridge: TerminalCallbackBridge,
        configuration: TerminalSurfaceOptions,
        config: inout ghostty_surface_config_s,
        platformSetup: (inout ghostty_surface_config_s) -> Void
    ) -> ghostty_surface_t? {
        withOptionalCString(configuration.workingDirectory) { workingDirectoryPtr in
            withOptionalCString(configuration.command) { commandPtr in
                config.working_directory = workingDirectoryPtr
                config.command = commandPtr
                return withEnvironment(configuration.environment) { envVars, envCount in
                    config.env_vars = envVars
                    config.env_var_count = envCount
                    return buildSurface(
                        app: app,
                        bridge: bridge,
                        configuration: configuration,
                        config: &config,
                        platformSetup: platformSetup
                    )
                }
            }
        }
    }

    private func withOptionalCString<Result>(
        _ value: String?,
        body: (UnsafePointer<CChar>?) -> Result
    ) -> Result {
        guard let value else {
            return body(nil)
        }
        return value.withCString { ptr in
            body(ptr)
        }
    }

    private func withEnvironment<Result>(
        _ environment: [String: String],
        body: (UnsafeMutablePointer<ghostty_env_var_s>?, Int) -> Result
    ) -> Result {
        let pairs = environment.sorted { $0.key < $1.key }
        guard !pairs.isEmpty else {
            return body(nil, 0)
        }

        let keyPointers = pairs.map { strdup($0.key)! }
        let valuePointers = pairs.map { strdup($0.value)! }
        defer {
            keyPointers.forEach { free($0) }
            valuePointers.forEach { free($0) }
        }

        let envVars = UnsafeMutablePointer<ghostty_env_var_s>.allocate(
            capacity: pairs.count
        )
        defer {
            envVars.deallocate()
        }
        for index in pairs.indices {
            envVars[index].key = UnsafePointer(keyPointers[index])
            envVars[index].value = UnsafePointer(valuePointers[index])
        }
        return body(envVars, pairs.count)
    }

    private func buildSurface(
        app: ghostty_app_t,
        bridge: TerminalCallbackBridge,
        configuration: TerminalSurfaceOptions,
        config: inout ghostty_surface_config_s,
        platformSetup: (inout ghostty_surface_config_s) -> Void
    ) -> ghostty_surface_t? {
        platformSetup(&config)
        guard let surface = ghostty_surface_new(app, &config) else {
            return nil
        }

        retain(bridge)

        if case let .inMemory(session) = configuration.backend {
            session.setSurface(surface)
        }

        return surface
    }
}
