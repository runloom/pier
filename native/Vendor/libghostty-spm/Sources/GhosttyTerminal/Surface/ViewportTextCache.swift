/// Skip `dumpTextLocked` when the grid epoch has not advanced.
/// Host writes, resize, and Ghostty RENDER bump the epoch; cursor blink
/// that only redraws pixels does not, so idle polls reuse the last dump.
/// Occluded surfaces must not use this cache: Ghostty may omit RENDER
/// while hidden, so PTY writes would otherwise look unchanged.
struct ViewportTextCache {
    private var epoch: UInt64 = 0
    private var cachedEpoch: UInt64?
    private var cachedText: String?
    private(set) var dumpCount: UInt64 = 0
    private(set) var hitCount: UInt64 = 0

    mutating func noteChanged() {
        epoch &+= 1
    }

    mutating func clear() {
        epoch &+= 1
        cachedEpoch = nil
        cachedText = nil
    }

    mutating func read(dump: () -> String?) -> String? {
        if cachedEpoch == epoch, let cachedText {
            hitCount &+= 1
            return cachedText
        }
        dumpCount &+= 1
        guard let text = dump() else {
            cachedEpoch = nil
            cachedText = nil
            return nil
        }
        cachedEpoch = epoch
        cachedText = text
        return text
    }

    mutating func readUncached(dump: () -> String?) -> String? {
        dumpCount &+= 1
        return dump()
    }
}
