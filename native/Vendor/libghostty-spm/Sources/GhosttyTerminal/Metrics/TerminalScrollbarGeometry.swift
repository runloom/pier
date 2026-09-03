/// Unflipped NSScrollView mapping for Ghostty scrollbar rows.
///
/// Matches Ghostty.app `SurfaceScrollView.synchronizeScrollView`:
/// `offsetY = (total - offset - len) * cellHeight`.
/// Viewport ownership stays in libghostty; the host only places chrome.
public enum TerminalScrollbarGeometry {
    public static func maxOffset(total: UInt64, length: UInt64) -> UInt64 {
        guard total > length else { return 0 }
        return total - length
    }

    /// Unflipped NSScrollView: y = 0 is the live (bottom) edge of the document.
    public static func clipOriginY(
        offset: UInt64,
        total: UInt64,
        length: UInt64,
        cellHeight: Double
    ) -> Double {
        let maxOffset = Self.maxOffset(total: total, length: length)
        let clamped = min(offset, maxOffset)
        let bottomRows = total - min(total, clamped + length)
        return Double(bottomRows) * cellHeight
    }
}
