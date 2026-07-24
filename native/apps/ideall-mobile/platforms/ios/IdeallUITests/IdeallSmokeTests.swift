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
        configureLaunch(app, smokeAction: 1)
        app.launch()

        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20))
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 10))
        attachScreenshot(named: "01-launched", from: window)

        // GPUI paints its controls without a complete native accessibility
        // tree, and its embedded UIWindow is not a UIScene touch target under
        // XCTest. UI-test-only launch actions exercise the real GPUI business
        // paths while Android smoke covers physical touch hit-testing.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let deviceWindow = springboard.windows.firstMatch
        XCTAssertTrue(deviceWindow.waitForExistence(timeout: 10))
        let deviceFrame = deviceWindow.frame
        assertFullScreen(window.frame, matches: deviceFrame)
        let bodyInput = try XCTUnwrap(
            waitForInput("正文", in: app)
        )
        bodyInput.typeText("ideall iOS smoke body\nsecond line")
        waitForAutosave()

        relaunch(app, smokeAction: 2)
        let titleInput = try XCTUnwrap(
            waitForInput("标题", in: app)
        )
        titleInput.typeText("ideall iOS smoke title\n")
        waitForAutosave()

        relaunch(app, smokeAction: 3)
        let resumedBodyInput = try XCTUnwrap(
            waitForInput("正文", in: app)
        )
        XCTAssertTrue(
            (resumedBodyInput.value as? String)?.contains("second line") == true,
            "正文应在重启并切换焦点后恢复"
        )
        resumedBodyInput.typeText("\nthird line")
        waitForAutosave()
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
        configureLaunch(app, smokeAction: nil)
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

    private func waitForInput(
        _ label: String,
        in app: XCUIApplication
    ) -> XCUIElement? {
        let input = app.textViews[label]
        guard input.waitForExistence(timeout: 5) else {
            return nil
        }
        return input
    }

    private func configureLaunch(_ app: XCUIApplication, smokeAction: Int?) {
        app.launchArguments = ["-IDEALLUITesting"]
        if let smokeAction {
            app.launchArguments += ["-IDEALLSmokeAction", String(smokeAction)]
        }
    }

    private func relaunch(_ app: XCUIApplication, smokeAction: Int) {
        app.terminate()
        configureLaunch(app, smokeAction: smokeAction)
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20))
    }

    private func waitForAutosave() {
        Thread.sleep(forTimeInterval: 2)
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
