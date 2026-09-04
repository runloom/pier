import XCTest
@testable import GhosttyTerminal

final class HostLinkClickTests: XCTestCase {
    func testConsumesFileHttpMailtoAndPier() {
        XCTAssertTrue(HostLinkClick.shouldConsume("file:///tmp/a.md"))
        XCTAssertTrue(HostLinkClick.shouldConsume("https://x.test/a"))
        XCTAssertTrue(HostLinkClick.shouldConsume("http://x.test"))
        XCTAssertTrue(HostLinkClick.shouldConsume("mailto:a@b.c"))
        XCTAssertTrue(HostLinkClick.shouldConsume("pier://file/Users/a/repo/docs/a.md#L12"))
    }

    func testConsumesSchemelessPaths() {
        XCTAssertTrue(HostLinkClick.shouldConsume("/tmp/a.md"))
        XCTAssertTrue(HostLinkClick.shouldConsume("docs/foo.md"))
        XCTAssertTrue(HostLinkClick.shouldConsume("./src/main.ts"))
        XCTAssertTrue(HostLinkClick.shouldConsume("~/notes.txt"))
    }

    func testRejectsEmptyDangerousAndForeignEditors() {
        XCTAssertFalse(HostLinkClick.shouldConsume(""))
        XCTAssertFalse(HostLinkClick.shouldConsume("   "))
        XCTAssertFalse(HostLinkClick.shouldConsume("javascript:alert(1)"))
        XCTAssertFalse(HostLinkClick.shouldConsume("data:text/html,hi"))
        XCTAssertFalse(HostLinkClick.shouldConsume("vbscript:msg"))
        XCTAssertFalse(HostLinkClick.shouldConsume("vscode://file/x"))
        XCTAssertFalse(HostLinkClick.shouldConsume("cursor://file/x"))
        XCTAssertFalse(HostLinkClick.shouldConsume("zed://file/x"))
        XCTAssertFalse(HostLinkClick.shouldConsume("idea://open"))
    }
}
