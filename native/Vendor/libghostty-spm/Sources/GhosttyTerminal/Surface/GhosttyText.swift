import GhosttyKit

enum GhosttyText {
    static func decode(_ out: ghostty_text_s) -> String {
        guard let textPtr = out.text, out.text_len > 0 else {
            return ""
        }
        let count = Int(out.text_len)
        return textPtr.withMemoryRebound(to: UInt8.self, capacity: count) { utf8 in
            String(decoding: UnsafeBufferPointer(start: utf8, count: count), as: UTF8.self)
        }
    }

    static func readViewport(from surface: ghostty_surface_t) -> String? {
        let topLeft = ghostty_point_s(
            tag: GHOSTTY_POINT_VIEWPORT,
            coord: GHOSTTY_POINT_COORD_TOP_LEFT,
            x: 0,
            y: 0
        )
        let bottomRight = ghostty_point_s(
            tag: GHOSTTY_POINT_VIEWPORT,
            coord: GHOSTTY_POINT_COORD_BOTTOM_RIGHT,
            x: 0,
            y: 0
        )
        let selection = ghostty_selection_s(
            top_left: topLeft,
            bottom_right: bottomRight,
            rectangle: false
        )
        var out = ghostty_text_s()
        guard ghostty_surface_read_text(surface, selection, &out) else {
            return nil
        }
        defer { ghostty_surface_free_text(surface, &out) }
        return decode(out)
    }
}
