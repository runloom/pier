// native/Sources/GhosttyBridge/TerminalHoleMask.swift
//
// Chromium 合成层（ViewsCompositorSuperview）覆盖整个窗口，终端 NSView 在它下面。
// 产品靠「终端区域 web 输出 alpha=0」暴露 native 终端；但用户 HTML 不可控，
// backdrop-filter / 3D transform 会把区域提升成独立合成层，macOS 还可能保留旧层
// 像素，web 就会盖在终端上（内容重叠 / 残影）。
//
// 这个类型给合成层挂一张 CAShapeLayer mask：整窗可见，所有 visible 终端 viewport
// 挖成洞，只把 webOverlayRects 与终端的交集回填。洞是硬裁，web 在终端矩形里画不出
// 任何像素；需要盖住终端的产品浮层必须登记在 webOverlayRects（唯一几何真源）。
//
// 坐标：renderer 传 contentView top-left CSS px；Electron 43 macOS 的合成层未翻转，
// mask 路径用 bottom-left。NSView.convert 已处理 view 翻转，路径直接吃转换结果。

import AppKit
import QuartzCore

@MainActor
enum TerminalHoleMask {
    private struct MaskEntry {
        weak var compositor: NSView?
        let layer: CAShapeLayer
        /// 最近一次挖掉的洞，contentView top-left 坐标，只用于 debug snapshot。
        var holes: [NSRect]
    }

    /// 按 compositor 对象身份缓存 mask 层，避免每次状态 apply 都换新 layer。
    /// 弱引用 compositor：窗口销毁 / Chromium 重建合成层后清掉陈旧条目。
    private static var entries: [ObjectIdentifier: MaskEntry] = [:]

    // MARK: - Public

    /// 重新计算并应用洞遮罩。terminals / overlays 都是 contentView top-left 坐标。
    static func apply(
        contentView: NSView,
        terminals: [NSRect],
        overlays: [NSRect]
    ) {
        guard let compositor = findCompositor(in: contentView) else { return }
        let holes = holeRects(terminals: terminals, overlays: overlays)
        guard !holes.isEmpty else {
            removeMask(from: compositor)
            return
        }
        compositor.wantsLayer = true
        guard let hostLayer = compositor.layer else { return }

        let key = ObjectIdentifier(compositor)
        entries = entries.filter { $0.value.compositor != nil }
        let mask: CAShapeLayer
        if let entry = entries[key], entry.layer === hostLayer.mask {
            mask = entry.layer
        } else {
            mask = CAShapeLayer()
            mask.fillColor = NSColor.black.cgColor
            mask.fillRule = .evenOdd
            entries[key] = MaskEntry(compositor: compositor, layer: mask, holes: [])
        }

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        mask.frame = CGRect(origin: .zero, size: compositor.bounds.size)
        let path = CGMutablePath()
        path.addRect(CGRect(origin: .zero, size: compositor.bounds.size))
        for hole in holes {
            path.addRect(layerRect(hole, contentView: contentView, compositor: compositor))
        }
        mask.path = path
        hostLayer.mask = mask
        entries[key]?.holes = holes
        CATransaction.commit()
    }

    /// 移除洞遮罩（没有可见终端 / closeAll / detachWindow）。
    static func clear(contentView: NSView) {
        guard let compositor = findCompositor(in: contentView) else { return }
        removeMask(from: compositor)
    }

    /// debugSnapshot 用：当前是否挂了 mask、挖了哪些洞。
    static func debugPayload(contentView: NSView) -> [String: Any] {
        guard let compositor = findCompositor(in: contentView) else {
            return ["active": false, "compositor": false]
        }
        let entry = entries[ObjectIdentifier(compositor)]
        let holes = entry?.holes ?? []
        return [
            "active": compositor.layer?.mask != nil,
            "compositor": true,
            "cutRectCount": holes.count,
            "cutRects": holes.map {
                [
                    "height": Double($0.height),
                    "width": Double($0.width),
                    "x": Double($0.minX),
                    "y": Double($0.minY),
                ]
            },
        ]
    }

    // MARK: - Geometry (exposed for tests)

    /// 每个终端矩形减去所有与它相交的浮层矩形；剩下的才是必须挖掉的洞。
    /// 浮层在终端外、或完全覆盖终端时不会产生负数或空矩形。
    static func holeRects(terminals: [NSRect], overlays: [NSRect]) -> [NSRect] {
        var result: [NSRect] = []
        // even-odd 路径里两个洞重叠会把交集翻回可见；正常布局终端互不重叠，
        // 这里合并重叠矩形做防御（过渡态偶发重叠也不给 web 留缝）。
        for terminal in merged(terminals) {
            var pieces = [terminal]
            for overlay in overlays where overlay.width > 0 && overlay.height > 0 {
                pieces = pieces.flatMap { subtract($0, overlay) }
                if pieces.isEmpty { break }
            }
            result.append(contentsOf: pieces)
        }
        return result
    }

    /// 合并相交矩形，保证 any 两个结果矩形互不重叠（even-odd 的前提）。
    static func merged(_ rects: [NSRect]) -> [NSRect] {
        var merged: [NSRect] = []
        for rect in rects where rect.width > 0 && rect.height > 0 {
            var candidate = rect
            var index = 0
            while index < merged.count {
                if merged[index].intersects(candidate) {
                    candidate = merged.remove(at: index).union(candidate)
                    index = 0
                } else {
                    index += 1
                }
            }
            merged.append(candidate)
        }
        return merged
    }

    /// rect − cutter，返回 0…4 个互不重叠的矩形（top-left / bottom-left 皆可，
    /// 减法与坐标方向无关）。
    static func subtract(_ rect: NSRect, _ cutter: NSRect) -> [NSRect] {
        let inter = rect.intersection(cutter)
        guard !inter.isNull, inter.width > 0, inter.height > 0 else {
            return [rect]
        }
        var pieces: [NSRect] = []
        if inter.minY > rect.minY {
            pieces.append(
                NSRect(
                    x: rect.minX,
                    y: rect.minY,
                    width: rect.width,
                    height: inter.minY - rect.minY
                )
            )
        }
        if inter.maxY < rect.maxY {
            pieces.append(
                NSRect(
                    x: rect.minX,
                    y: inter.maxY,
                    width: rect.width,
                    height: rect.maxY - inter.maxY
                )
            )
        }
        if inter.minX > rect.minX {
            pieces.append(
                NSRect(
                    x: rect.minX,
                    y: inter.minY,
                    width: inter.minX - rect.minX,
                    height: inter.height
                )
            )
        }
        if inter.maxX < rect.maxX {
            pieces.append(
                NSRect(
                    x: inter.maxX,
                    y: inter.minY,
                    width: rect.maxX - inter.maxX,
                    height: inter.height
                )
            )
        }
        return pieces
    }

    /// contentView top-left 矩形 → compositor 本地 mask 路径坐标。
    static func layerRect(
        _ topLeft: NSRect,
        contentView: NSView,
        compositor: NSView
    ) -> NSRect {
        let contentRect: NSRect
        if contentView.isFlipped {
            contentRect = topLeft
        } else {
            contentRect = NSRect(
                x: topLeft.minX,
                y: contentView.bounds.height - topLeft.minY - topLeft.height,
                width: topLeft.width,
                height: topLeft.height
            )
        }
        var local = compositor.convert(contentRect, from: contentView)
        local.origin.x -= compositor.bounds.minX
        local.origin.y -= compositor.bounds.minY
        return local
    }

    // MARK: - Private

    private static func removeMask(from compositor: NSView) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        compositor.layer?.mask = nil
        CATransaction.commit()
        entries.removeValue(forKey: ObjectIdentifier(compositor))
    }

    /// Chromium 真正的渲染层叫 ViewsCompositorSuperview；WebContentsViewCocoa 只是
    /// 空 wrapper，mask 挂错层不会影响像素。
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
