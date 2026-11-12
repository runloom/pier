// native/Sources/GhosttyBridge/TerminalShadow.swift
//
// box-shadow 画在 border box 外面。洞只回填 border box，盒外的阴影在终端上被硬裁；
// 非终端区域没有洞，同一条 CSS 阴影仍然可见。把回填矩形扩到阴影盒会把半透明
// 像素铺在不透明 backing 上，和圆角脏边是同一类问题。
//
// 这里在 web 合成层之下、终端之上，按 computed outset shadow 再画一遍。
// 卡片回填盖住投影中心，只有探进终端洞的那一圈看得见，并且是叠在终端上。

import AppKit
import QuartzCore

/// 不参与命中。类型名含 TerminalShadow，测试靠它认这层。
final class TerminalShadowView: NSView {
    override func hitTest(_: NSPoint) -> NSView? {
        nil
    }
}

@MainActor
enum TerminalShadow {
    struct Source {
        var blur: CGFloat
        var color: TerminalScrim.WashColor
        var frame: NSRect
        var radius: CGFloat
        var spread: CGFloat
        var x: CGFloat
        var y: CGFloat
    }

    struct Shape: Equatable {
        var radius: CGFloat
        var rect: NSRect
    }

    private struct Entry {
        weak var contentView: NSView?
        let view: TerminalShadowView
    }

    private static var entries: [ObjectIdentifier: Entry] = [:]

    /// 投影形状 = border box 按 spread 外扩。负 spread 内缩；缩没了就不画。
    /// 正 spread 会把圆角加大同样的量，和 CSS 一致。
    static func shape(frame: NSRect, radius: CGFloat, spread: CGFloat) -> Shape? {
        let rect = frame.insetBy(dx: -spread, dy: -spread)
        guard rect.width > 0.5, rect.height > 0.5 else { return nil }
        let corner = min(max(radius + spread, 0), min(rect.width, rect.height) / 2)
        return Shape(radius: corner, rect: rect)
    }

    /// CSS blur → CALayer.shadowRadius。CoreGraphics 的 blur 约是 CSS 的一半
    /// （WebKit 画 box-shadow 时同样除以 2）。
    static func layerBlur(_ cssBlur: CGFloat) -> CGFloat {
        max(cssBlur, 0) / 2
    }

    static func apply(contentView: NSView, shadows: [Source]) {
        guard !shadows.isEmpty, let compositor = findCompositor(in: contentView) else {
            clear(contentView: contentView)
            return
        }

        entries = entries.filter { $0.value.contentView != nil }
        let key = ObjectIdentifier(contentView)
        let view = entries[key]?.view ?? TerminalShadowView(frame: contentView.bounds)
        view.wantsLayer = true
        view.frame = contentView.bounds
        view.autoresizingMask = [.width, .height]
        // 后于 scrim 插入，所以压在蒙层之上、合成层之下。
        contentView.addSubview(view, positioned: .below, relativeTo: compositor)

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        view.layer?.sublayers = nil
        let scale = contentView.window?.backingScaleFactor ?? 2
        for shadow in shadows {
            let extends = shadow.blur > 0 || shadow.spread > 0 || shadow.x != 0 || shadow.y != 0
            guard extends, shadow.color.isVisible, let cast = shape(
                frame: shadow.frame,
                radius: shadow.radius,
                spread: shadow.spread
            ) else { continue }
            let layer = CALayer()
            layer.contentsScale = scale
            layer.frame = TerminalHoleMask.layerRect(
                cast.rect,
                contentView: contentView,
                compositor: view
            )
            layer.masksToBounds = false
            layer.shadowColor = NSColor(
                srgbRed: shadow.color.r,
                green: shadow.color.g,
                blue: shadow.color.b,
                alpha: 1
            ).cgColor
            layer.shadowOpacity = Float(shadow.color.a)
            layer.shadowRadius = layerBlur(shadow.blur)
            layer.shadowOffset = layerOffset(
                x: shadow.x,
                y: shadow.y,
                contentView: contentView,
                host: view
            )
            layer.shadowPath = CGPath(
                roundedRect: layer.bounds,
                cornerWidth: cast.radius,
                cornerHeight: cast.radius,
                transform: nil
            )
            view.layer?.addSublayer(layer)
        }
        CATransaction.commit()
        if view.layer?.sublayers?.isEmpty != false {
            clear(contentView: contentView)
            return
        }
        entries[key] = Entry(contentView: contentView, view: view)
    }

    static func clear(contentView: NSView) {
        let key = ObjectIdentifier(contentView)
        entries[key]?.view.removeFromSuperview()
        entries.removeValue(forKey: key)
        entries = entries.filter { $0.value.contentView != nil }
    }

    /// CSS 偏移（y 向下）→ host layer 的 shadowOffset。
    private static func layerOffset(
        x: CGFloat,
        y: CGFloat,
        contentView: NSView,
        host: NSView
    ) -> CGSize {
        let origin = TerminalHoleMask.layerRect(
            NSRect(x: 0, y: 0, width: 1, height: 1),
            contentView: contentView,
            compositor: host
        )
        let shifted = TerminalHoleMask.layerRect(
            NSRect(x: x, y: y, width: 1, height: 1),
            contentView: contentView,
            compositor: host
        )
        return CGSize(width: shifted.minX - origin.minX, height: shifted.minY - origin.minY)
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
