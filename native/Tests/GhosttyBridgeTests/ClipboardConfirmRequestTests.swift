import GhosttyKit
import XCTest
@testable import GhosttyTerminal

final class ClipboardConfirmRequestTests: XCTestCase {
    func testCompleteSendsDisplayedContentsOnce() {
        var payloads: [String?] = []
        let request = ClipboardConfirmRequest(
            contents: "ls\n",
            kind: .paste
        ) { payload in
            payloads.append(payload)
        }

        request.complete()
        request.complete()
        request.cancel()

        XCTAssertEqual(payloads, ["ls\n"])
    }

    func testCancelSendsNilPayloadOnce() {
        var payloads: [String?] = []
        let request = ClipboardConfirmRequest(
            contents: "rm -rf /\n",
            kind: .paste
        ) { payload in
            payloads.append(payload)
        }

        request.cancel()
        request.complete()

        XCTAssertEqual(payloads, [nil])
    }

    func testDeinitSchedulesCancelWhenUnresolved() async {
        let finished = expectation(description: "deinit cancel")
        var payload: String? = "unset"
        finished.assertForOverFulfill = true

        do {
            let request = ClipboardConfirmRequest(
                contents: "echo hi\n",
                kind: .osc52Read
            ) { value in
                payload = value
                finished.fulfill()
            }
            _ = request
        }

        await fulfillment(of: [finished], timeout: 1)
        XCTAssertNil(payload)
    }

    func testStateTakeIsSingleShot() {
        let pointer = UnsafeMutableRawPointer(bitPattern: 1)!
        let state = ClipboardConfirmState(pointer)

        XCTAssertFalse(state.isConsumed)
        XCTAssertEqual(state.take(), pointer)
        XCTAssertTrue(state.isConsumed)
        XCTAssertNil(state.take())
    }

    func testInFlightSlotTakeClearsStoredState() {
        let pointer = UnsafeMutableRawPointer(bitPattern: 2)!
        let state = ClipboardConfirmState(pointer)
        let slot = ClipboardConfirmInFlightSlot()

        slot.store(state)
        XCTAssertTrue(slot.take() === state)
        XCTAssertNil(slot.take())
    }

    func testAbortedWithUnchangedPendingCancels() {
        XCTAssertEqual(
            ClipboardConfirmAlert.action(
                pendingUnchanged: true,
                response: .aborted
            ),
            .finishCancel
        )
        XCTAssertEqual(
            ClipboardConfirmAlert.action(
                pendingUnchanged: true,
                response: .cancel
            ),
            .finishCancel
        )
        XCTAssertEqual(
            ClipboardConfirmAlert.action(
                pendingUnchanged: true,
                response: .accept
            ),
            .finishAccept
        )
        XCTAssertEqual(
            ClipboardConfirmAlert.action(
                pendingUnchanged: false,
                response: .aborted
            ),
            .presentNext
        )
    }

    func testKindMapsGhosttyClipboardRequest() {
        XCTAssertEqual(
            ClipboardConfirmRequest.Kind(GHOSTTY_CLIPBOARD_REQUEST_PASTE),
            .paste
        )
        XCTAssertEqual(
            ClipboardConfirmRequest.Kind(GHOSTTY_CLIPBOARD_REQUEST_OSC_52_READ),
            .osc52Read
        )
        XCTAssertEqual(
            ClipboardConfirmRequest.Kind(GHOSTTY_CLIPBOARD_REQUEST_OSC_52_WRITE),
            .osc52Write
        )
    }

    @MainActor
    func testReplacingPendingCancelsThePreviousRequest() {
        let bridge = TerminalCallbackBridge(delegate: nil)
        var firstPayload: String? = "unset"
        let first = ClipboardConfirmRequest(contents: "one\n", kind: .paste) {
            firstPayload = $0
        }
        let second = ClipboardConfirmRequest(contents: "two\n", kind: .paste) { _ in }
        bridge.pendingClipboardConfirmation = first
        bridge.pendingClipboardConfirmation = second

        XCTAssertEqual(firstPayload, nil)
        XCTAssertTrue(bridge.pendingClipboardConfirmation === second)

        second.cancel()
        bridge.pendingClipboardConfirmation = nil
    }

    @MainActor
    func testAdoptWithoutSurfaceDoesNotConsumeState() {
        let bridge = TerminalCallbackBridge(delegate: nil)
        let state = ClipboardConfirmState(UnsafeMutableRawPointer(bitPattern: 3)!)

        bridge.clipboardConfirmInFlight.store(state)
        bridge.adoptClipboardConfirmation(
            contents: "ls\n",
            kind: .paste,
            state: state
        )

        XCTAssertNil(bridge.pendingClipboardConfirmation)
        XCTAssertFalse(state.isConsumed)
        XCTAssertTrue(bridge.clipboardConfirmInFlight.take() === state)
    }
}
