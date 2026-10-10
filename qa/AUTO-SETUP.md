# Button onboarding verification

2026-10-07

## Implemented

- Header button opens a web setup dialog and checks the user's configured loopback Bridge.
- Offline users can download a Mac or Windows ZIP. Archives contain seven current Bridge source files, a launcher, site.json and instructions. Publisher sessions, environment files and connection keys are excluded.
- Launchers prepare a private Node.js 22 runtime from nodejs.org, check the vendor SHA-256 checksum, copy Bridge source into a user folder and run setup-bootstrap.js. No administrator privileges, native GUI app, security-policy changes or automatic-start registration.
- Bootstrap selects an available port in 4319..4349, starts a loopback Bridge with the exact website allowlist and a random pairing key, waits for readiness, then opens the website with connection data in its URL fragment. Re-running the launcher reuses a healthy matching Bridge.
- Website consumes the fragment on load or hashchange, saves settings in sessionStorage, clears the fragment and presents the account connection action. Existing publisher GPT/auth proxies stay disabled.

## Evidence

- npm run build passed, including TypeScript compilation, without filesystem tracing warnings.
- npm test: 72 passed, 0 failed. Installer tests validate source allowlist, ZIP CRC and metadata, no credential files, official runtime downloads/checksum enforcement, no policy bypass, invalid origins/platforms, fragment validation and automatic fragment cleanup. Existing account isolation, Bridge CORS/pairing and workflow tests remain green.
- Actual browser button downloaded `/path/to/downloads/Frameflow-Setup-mac.zip`. The browser automation download event timed out, but the actual file existed; unzip -t reported all 10 entries valid. Start.command extracted with executable mode 755.
- Executed the downloaded Mac launcher in an isolated temporary installation directory. It downloaded and verified Node.js v22.23.3, started the actual Bridge at 127.0.0.1:4321 and returned successfully. Second execution reused the same Bridge. The native browser-open call was captured by qa/setup-open-check.cjs to keep testing inside the controlled browser; operating-system double-click/quarantine UI was not tested.
- Navigated the IAB to the captured return link using browser automation. The app displayed that this computer was connected without address/key input, and the URL was cleared to http://127.0.0.1:4320/.
- Keyboard Shift+Tab from the dialog's close button wrapped to its last action. Responsive document width equals viewport at 390, 768 and 1280px. Panel bounds: 24..366, 124..644, 380..900 respectively. Viewport override restored.
- Screenshot: auto-setup-ready.png; mobile: auto-setup-390.png.
- Restored the existing development connection at port 4329. Stopped only the temporary Bridge PID 53686 and removed its temporary installation and pairing records. Existing web/Bridge services stayed available.

## Limits

- First use requires opening the downloaded start file and accepting any operating-system file-execution or browser loopback permission prompts. The web cannot silently install/launch local code.
- Windows launcher archive and encoded command were structurally tested (longest cmd line 4762 characters), but actual Windows execution was not available.
- Cloudflare public HTTPS-to-loopback testing and deployment were not performed. Existing official device account authentication remains unchanged; no new OAuth login or charged image request was made during this task.
- Linux and phones have no automatic installer. Reopen the start file after rebooting the computer.
