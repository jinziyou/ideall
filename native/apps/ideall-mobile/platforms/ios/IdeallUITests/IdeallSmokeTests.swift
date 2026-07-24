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
        app.launchEnvironment["IDEALL_UI_TESTING"] = "1"
        app.launchArguments.append("-IDEALLUITesting")
        app.launch()

        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20))
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 10))
        attachScreenshot(named: "01-launched", from: window)

        // GPUI currently paints its own controls without a complete native
        // accessibility tree. UI-test-only UIKit proxies receive XCTest
        // activations and forward them as ordinary GPUI mouse-down/up events.
        // The launch-screen declaration must also keep the app out of iOS
        // legacy letterbox mode so both sides share one viewport.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let deviceWindow = springboard.windows.firstMatch
        XCTAssertTrue(deviceWindow.waitForExistence(timeout: 10))
        let deviceFrame = deviceWindow.frame
        assertFullScreen(window.frame, matches: deviceFrame)
        let bodyInput = try XCTUnwrap(
            focusInput(
                "正文",
                in: app,
                through: "新建笔记"
            )
        )
        bodyInput.typeText("ideall iOS smoke body\nsecond line")

        let titleInput = try XCTUnwrap(
            focusInput(
                "标题",
                in: app,
                through: "聚焦标题"
            )
        )
        titleInput.typeText("ideall iOS smoke title\n")

        let resumedBodyInput = try XCTUnwrap(
            focusInput(
                "正文",
                in: app,
                through: "聚焦正文"
            )
        )
        resumedBodyInput.typeText("\nthird line")
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

    private func focusInput(
        _ label: String,
        in app: XCUIApplication,
        through proxyLabel: String
    ) -> XCUIElement? {
        let proxy = app.buttons[proxyLabel]
        guard proxy.waitForExistence(timeout: 5) else {
            return nil
        }
        proxy.tap()

        let input = app.textViews[label]
        guard input.waitForExistence(timeout: 5) else {
            return nil
        }
        input.tap()
        return input
    }

    private func assertFullScreen(_ appFrame: CGRect, matches deviceFrame: CGRect) {
        XCTAssertEqual(appFrame.minX, deviceFrame.minX, accuracy: 1)
        XCTAssertEqual(appFrame.minY, deviceFrame.minY, accuracy: 1)
        XCTAssertEqual(appFrame.width, deviceFrame.width, accuracy: 1)
        XCTAssertEqual(appFrame.height, deviceFrame.height, accuracy: 1)
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
