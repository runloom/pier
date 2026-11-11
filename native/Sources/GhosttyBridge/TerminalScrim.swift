// native/Sources/GhosttyBridge/TerminalScrim.swift
//
// 弹窗蒙层是半透明的，不能靠回填洞来盖住终端：web backing 不透明，回填
// 会把终端换成兜底色。这里在 web 合成层之下、终端之上，按蒙层色画一层
// 半透明，只覆盖蒙层矩形与终端 viewport 的交集。点击仍由既有 overlay
// 路由处理，这层不命中。

import AppKit
import QuartzCore

/// 不参与命中。类型名含 TerminalScrim，debug / 测试靠它认这层。
final class TerminalScrimView: NSView {
    override func hitTest(_: NSPoint) -> NSView? {
        nil
    }
}

@MainActor
enum TerminalScrim {
    struct WashColor {
        var a: Double
        var b: Double
        var g: Double
        var r: Double

        var isVisible: Bool {
            [r, g, b, a].allSatisfy(\.isFinite)
                && (0...1).contains(r)
                && (0...1).contains(g)
                && (0...1).contains(b)
                && a > 0
                && a <= 1
        }

        var cgColor: CGColor {
            NSColor(srgbRed: r, green: g, blue: b, alpha: a).cgColor
        }
    }

    struct Source {
        var color: WashColor
        var frame: NSRect
    }

    private struct Wash {
        var color: WashColor
        var frame: NSRect
    }

    private struct Entry {
        weak var contentView: NSView?
        let view: TerminalScrimView
        var washes: [Wash]
    }

    private static var entries: [ObjectIdentifier: Entry] = [:]

    /// 蒙层矩形 ∩ 终端 viewport。坐标与洞遮罩相同：contentView top-left。
    private static func coveredRects(terminals: [NSRect], scrims: [Source]) -> [Wash] {
        var result: [Wash] = []
        for scrim in scrims
        where scrim.color.isVisible && scrim.frame.width > 0 && scrim.frame.height > 0 {
            for terminal in terminals where terminal.width > 0 && terminal.height > 0 {
                let inter = terminal.intersection(scrim.frame)
                guard !inter.isNull, inter.width > 0, inter.height > 0 else { continue }
                result.append(Wash(color: scrim.color, frame: inter))
            }
        }
        return result
    }

    static func apply(contentView: NSView, terminals: [NSRect], scrims: [Source]) {
        let washes = coveredRects(terminals: terminals, scrims: scrims)
        guard !washes.isEmpty, let compositor = findCompositor(in: contentView) else {
            clear(contentView: contentView)
            return
        }

        entries = entries.filter { $0.value.contentView != nil }
        let key = ObjectIdentifier(contentView)
        let view = entries[key]?.view ?? TerminalScrimView(frame: contentView.bounds)
        view.wantsLayer = true
        view.frame = contentView.bounds
        view.autoresizingMask = [.width, .height]
        // 合成层之下，洞里才能看见这层，卡片回填仍盖在上面。scrim 必须排在
        // 已存在的 TerminalShadow 之下（蒙层压暗一切，投影是浮层自己的铬）：
        // 有 shadow view 时插到它下面，否则直接贴到合成层下。
        let below = contentView.subviews.last {
            String(describing: type(of: $0)).contains("TerminalShadow")
        }
        if let below {
            contentView.addSubview(view, positioned: .below, relativeTo: below)
        } else {
            contentView.addSubview(view, positioned: .below, relativeTo: compositor)
        }

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        view.layer?.sublayers = nil
        for wash in washes {
            let layer = CALayer()
            layer.backgroundColor = wash.color.cgColor
            layer.frame = TerminalHoleMask.layerRect(
                wash.frame,
                contentView: contentView,
                compositor: view
            )
            view.layer?.addSublayer(layer)
        }
        CATransaction.commit()
        entries[key] = Entry(contentView: contentView, view: view, washes: washes)
    }

    static func clear(contentView: NSView) {
        let key = ObjectIdentifier(contentView)
        entries[key]?.view.removeFromSuperview()
        entries.removeValue(forKey: key)
        entries = entries.filter { $0.value.contentView != nil }
    }

    static func debugPayload(contentView: NSView) -> [String: Any] {
        let washes = entries[ObjectIdentifier(contentView)]?.washes ?? []
        return [
            "active": !washes.isEmpty,
            "rects": washes.map {
                [
                    "a": $0.color.a,
                    "b": $0.color.b,
                    "g": $0.color.g,
                    "height": Double($0.frame.height),
                    "r": $0.color.r,
                    "width": Double($0.frame.width),
                    "x": Double($0.frame.minX),
                    "y": Double($0.frame.minY),
                ]
            },
        ]
    }

    private static func findCompositor(in view: NSView) -> NSView? {
        for subview in view.subviews {
            let name = String(describing: type(of: subview))
            if name.contains("ViewsCompositorSuperview") {
                return subview
            }
            if let nested = findCompositor(in: subview) {
                return nested
            }
        }
        return nil
    }
}
