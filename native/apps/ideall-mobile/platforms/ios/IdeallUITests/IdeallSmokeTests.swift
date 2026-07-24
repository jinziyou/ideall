import XCTest

final class IdeallSmokeTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }

    override func tearDownWithError() throws {
        XCUIDevice.shared.orientation = .portrait
    }

    func testCreateNoteInputAndLifecycleRecovery() throws {
        let app = XCUIApplication()
        app.launchEnvironment["IDEALL_CRASH_DIAGNOSTICS"] = "1"
        app.launch()

        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20))
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 10))
        attachScreenshot(named: "01-launched", from: window)

        // GPUI currently paints its own controls, so use stable normalized
        // app coordinates until gpui-mobile exposes a complete accessibility
        // tree. The Window accessibility frame can be cropped by simulator
        // chrome and the software keyboard, so it is not a stable tap origin.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.87, dy: 0.10)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        app.typeText("ideall iOS smoke body\nsecond line")

        app.coordinate(withNormalizedOffset: CGVector(dx: 0.50, dy: 0.17)).tap()
        app.typeText("ideall iOS smoke title\n")

        app.coordinate(withNormalizedOffset: CGVector(dx: 0.50, dy: 0.44)).tap()
        app.typeText("\nthird line")
        attachScreenshot(named: "02-edited-note", from: window)

        app.swipeUp()
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        attachScreenshot(named: "03-landscape", from: window)

        XCUIDevice.shared.press(.home)
        XCTAssertTrue(waitForBackground(app, timeout: 10))
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15))

        XCUIDevice.shared.orientation = .portrait
        attachScreenshot(named: "04-resumed", from: app.windows.firstMatch)

        app.terminate()
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20))
        attachScreenshot(named: "05-relaunched", from: app.windows.firstMatch)
    }

    private func attachScreenshot(named name: String, from element: XCUIElement) {
        let attachment = XCTAttachment(screenshot: element.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func waitForBackground(_ app: XCUIApplication, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if app.state == .runningBackground || app.state == .runningBackgroundSuspended {
                return true
            }
            Thread.sleep(forTimeInterval: 0.2)
        }
        return false
    }
}
