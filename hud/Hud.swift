// Floating feedback panel. One process per feedback: shows, waits, exits.
// Input: argv[1] = JSON {"issues":[{"type","original","suggestion","explanation"}], "natural": string|null, "url": string}
// Click → open the coach page and close. Auto-closes; the timer pauses while the mouse is over it.
// Never takes focus, so the user's typing is not interrupted.
import AppKit

struct Issue: Decodable { let type: String; let original: String; let suggestion: String; let explanation: String }
struct Payload: Decodable { let issues: [Issue]; let natural: String?; let url: String }

guard CommandLine.arguments.count > 1,
      let p = try? JSONDecoder().decode(Payload.self, from: Data(CommandLine.arguments[1].utf8)) else { exit(1) }

let app = NSApplication.shared
app.setActivationPolicy(.accessory) // no Dock icon, no focus steal

let width: CGFloat = 360
func label(_ s: String, size: CGFloat, weight: NSFont.Weight = .regular, color: NSColor = .labelColor) -> NSTextField {
  let l = NSTextField(wrappingLabelWithString: s)
  l.font = .systemFont(ofSize: size, weight: weight)
  l.textColor = color
  l.preferredMaxLayoutWidth = width - 32
  l.isSelectable = false
  return l
}

let stack = NSStackView()
stack.orientation = .vertical
stack.alignment = .leading
stack.spacing = 6
stack.edgeInsets = NSEdgeInsets(top: 14, left: 16, bottom: 14, right: 16)
stack.addArrangedSubview(label("Gramma", size: 11, weight: .semibold, color: .secondaryLabelColor))
for i in p.issues {
  stack.addArrangedSubview(label("\(i.original)  →  \(i.suggestion)", size: 15, weight: .semibold))
  stack.addArrangedSubview(label("\(i.type) · \(i.explanation)", size: 12, color: .secondaryLabelColor))
  stack.setCustomSpacing(10, after: stack.arrangedSubviews.last!)
}
if let n = p.natural, !n.isEmpty {
  stack.addArrangedSubview(label("Natural: \(n)", size: 12, color: .secondaryLabelColor))
}
stack.addArrangedSubview(label("Click to open Gramma", size: 10, color: .tertiaryLabelColor))

let blur = NSVisualEffectView()
blur.material = .hudWindow
blur.state = .active
blur.wantsLayer = true
blur.layer?.cornerRadius = 12
blur.layer?.masksToBounds = true
stack.translatesAutoresizingMaskIntoConstraints = false
blur.addSubview(stack)
NSLayoutConstraint.activate([
  stack.leadingAnchor.constraint(equalTo: blur.leadingAnchor),
  stack.trailingAnchor.constraint(equalTo: blur.trailingAnchor),
  stack.topAnchor.constraint(equalTo: blur.topAnchor),
  stack.bottomAnchor.constraint(equalTo: blur.bottomAnchor),
  stack.widthAnchor.constraint(equalToConstant: width),
])
blur.layoutSubtreeIfNeeded()
let size = stack.fittingSize

class Panel: NSPanel {
  var url = ""
  override var canBecomeKey: Bool { false }
  override func mouseDown(with event: NSEvent) {
    if let u = URL(string: url) { NSWorkspace.shared.open(u) }
    exit(0)
  }
}
let screen = NSScreen.main!.visibleFrame
let frame = NSRect(x: screen.maxX - size.width - 16, y: screen.maxY - size.height - 16, width: size.width, height: size.height)
let panel = Panel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
panel.url = p.url
panel.contentView = blur
panel.isOpaque = false
panel.backgroundColor = .clear
panel.hasShadow = true
panel.level = .statusBar
panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
panel.orderFrontRegardless()

// Reading time: 8 s + 4 s per issue. Paused while the mouse is over the panel.
var left = 8 + 4 * p.issues.count
Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
  if panel.frame.contains(NSEvent.mouseLocation) { return }
  left -= 1
  if left <= 0 { exit(0) }
}
app.run()
