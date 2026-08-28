//
//  TerminalPixelGeometry.swift
//  libghostty-spm
//
//  Single source of truth for view-point → device-pixel conversion.
//  Matches Ghostty's Zig `@intFromFloat` truncation (floor toward zero for
//  positive sizes) so setSize, drawableSize, and presentation-gate expected
//  pixels never disagree by ±1 and trigger IOSurface discard on macOS.
//

import CoreGraphics
import Foundation

public enum TerminalPixelGeometry {
    public struct Pixels: Equatable, Sendable {
        public let width: UInt32
        public let height: UInt32

        public init(width: UInt32, height: UInt32) {
            self.width = width
            self.height = height
        }
    }

    /// Convert point size × backing scale to integer device pixels.
    /// Returns `nil` when either dimension is non-positive.
    public static func pixels(
        size: (width: Double, height: Double),
        scale: Double
    ) -> Pixels? {
        guard size.width > 0, size.height > 0, scale > 0 else { return nil }
        let width = UInt32(size.width * scale)
        let height = UInt32(size.height * scale)
        guard width > 0, height > 0 else { return nil }
        return Pixels(width: width, height: height)
    }

    public static func pixels(size: CGSize, scale: Double) -> Pixels? {
        pixels(size: (Double(size.width), Double(size.height)), scale: scale)
    }

    public static func drawableSize(pixels: Pixels) -> CGSize {
        CGSize(width: CGFloat(pixels.width), height: CGFloat(pixels.height))
    }
}
