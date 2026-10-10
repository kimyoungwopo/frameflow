import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var serverProcess: Process?
    private let appURL = URL(string: "http://127.0.0.1:4184/")!
    private let projectPath = ProcessInfo.processInfo.environment["FRAMEFLOW_ROOT"] ?? FileManager.default.currentDirectoryPath

    func applicationDidFinishLaunching(_ notification: Notification) {
        startLocalServerIfNeeded()
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true

        window = NSWindow(contentRect: NSMakeRect(0, 0, 1440, 900),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "GPT Image Studio"
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        loadWhenReady()
    }

    private func startLocalServerIfNeeded() {
        let probe = Process()
        probe.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
        probe.arguments = ["--silent", "--fail", "--max-time", "1", "http://127.0.0.1:4184/"]
        do {
            try probe.run(); probe.waitUntilExit()
            if probe.terminationStatus == 0 { return }
        } catch {}

        let process = Process()
        let nodeCandidates = ["/usr/local/bin/node", "/opt/homebrew/bin/node"]
        if let nodePath = nodeCandidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) {
            process.executableURL = URL(fileURLWithPath: nodePath)
            process.arguments = ["server.js"]
        } else {
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = ["node", "server.js"]
        }
        process.currentDirectoryURL = URL(fileURLWithPath: projectPath)
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
        environment["PORT"] = "4184"
        process.environment = environment
        do {
            try process.run()
            serverProcess = process
        } catch {
            showError("로컬 서버를 시작할 수 없습니다: \(error.localizedDescription)")
        }
    }

    private func loadWhenReady(attempt: Int = 0) {
        let probe = Process()
        probe.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
        probe.arguments = ["--silent", "--fail", "--max-time", "1", appURL.absoluteString]
        do {
            try probe.run(); probe.waitUntilExit()
            if probe.terminationStatus == 0 {
                webView.load(URLRequest(url: appURL)); return
            }
        } catch {}
        if attempt < 30 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.loadWhenReady(attempt: attempt + 1) }
        } else {
            showError("로컬 서버가 응답하지 않습니다. 터미널에서 PORT=4184 node server.js를 실행해 주세요.")
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url,
           url.host == "chatgpt.com" || url.host == "auth.openai.com" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let process = serverProcess, process.isRunning { process.terminate() }
    }

    private func showError(_ message: String) {
        let alert = NSAlert(); alert.messageText = "GPT Image Studio"; alert.informativeText = message
        alert.alertStyle = .warning; alert.runModal()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
