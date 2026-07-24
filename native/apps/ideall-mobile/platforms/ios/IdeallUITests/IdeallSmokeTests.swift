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

        // GPUI currently paints its own controls, so use stable normalized
        // device-screen coordinates until gpui-mobile exposes a complete
        // accessibility tree. SpringBoard supplies the full device frame,
        // while the app Window remains the coordinate provider so synthesized
        // events stay on ideall's display and scene.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let deviceWindow = springboard.windows.firstMatch
        XCTAssertTrue(deviceWindow.waitForExistence(timeout: 10))
        let deviceFrame = deviceWindow.frame
        let bodyInput = try XCTUnwrap(
            focusInput(
                "正文",
                in: app,
                window: window,
                deviceFrame: deviceFrame,
                points: [
                    CGVector(dx: 0.87, dy: 0.08),
                    CGVector(dx: 0.87, dy: 0.09),
                    CGVector(dx: 0.87, dy: 0.10),
                    CGVector(dx: 0.87, dy: 0.11),
                    CGVector(dx: 0.87, dy: 0.12),
                    CGVector(dx: 0.82, dy: 0.10),
                    CGVector(dx: 0.92, dy: 0.10),
                ]
            )
        )
        bodyInput.typeText("ideall iOS smoke body\nsecond line")

        let titleInput = try XCTUnwrap(
            focusInput(
                "标题",
                in: app,
                window: window,
                deviceFrame: deviceFrame,
                points: [
                    CGVector(dx: 0.50, dy: 0.12),
                    CGVector(dx: 0.50, dy: 0.14),
                    CGVector(dx: 0.50, dy: 0.16),
                    CGVector(dx: 0.50, dy: 0.18),
                    CGVector(dx: 0.50, dy: 0.20),
                ]
            )
        )
        titleInput.typeText("ideall iOS smoke title\n")

        let resumedBodyInput = try XCTUnwrap(
            focusInput(
                "正文",
                in: app,
                window: window,
                deviceFrame: deviceFrame,
                points: [
                    CGVector(dx: 0.50, dy: 0.28),
                    CGVector(dx: 0.50, dy: 0.34),
                    CGVector(dx: 0.50, dy: 0.40),
                    CGVector(dx: 0.50, dy: 0.46),
                ]
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
        window: XCUIElement,
        deviceFrame: CGRect,
        points: [CGVector]
    ) -> XCUIElement? {
        let input = app.textViews[label]
        for point in points {
            let windowFrame = window.frame
            let target = CGPoint(
                x: deviceFrame.minX + deviceFrame.width * point.dx,
                y: deviceFrame.minY + deviceFrame.height * point.dy
            )
            let windowPoint = CGVector(
                dx: (target.x - windowFrame.minX) / windowFrame.width,
                dy: (target.y - windowFrame.minY) / windowFrame.height
            )
            window.coordinate(withNormalizedOffset: windowPoint).tap()
            if input.waitForExistence(timeout: 1) {
                input.tap()
                return input
            }
        }
        return nil
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
