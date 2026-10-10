const SOURCES = ['server.js', 'oauth.js', 'session-store.js', 'provider-adapter.js', 'planner-contract.js', 'responses-reader.js', 'setup-bootstrap.js'];
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), data = Buffer.from(entry.data), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(33, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50); header.writeUInt16LE(0x0314, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(33, 14); header.writeUInt32LE(crc, 16); header.writeUInt32LE(data.length, 20); header.writeUInt32LE(data.length, 24); header.writeUInt16LE(name.length, 28); header.writeUInt32LE(((entry.executable ? 0o100755 : 0o100644) << 16) >>> 0, 38); header.writeUInt32LE(offset, 42);
    central.push(header, name); offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}
function macLauncher() {
  return `#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
INSTALL_DIR="\${FRAMEFLOW_SETUP_DIR:-$HOME/Library/Application Support/FrameflowBridge}"
mkdir -p "$INSTALL_DIR"
chmod 700 "$INSTALL_DIR"
cp bridge/*.js site.json "$INSTALL_DIR/"
ARCH="$(uname -m)"
case "$ARCH" in arm64) ARCH=arm64 ;; x86_64) ARCH=x64 ;; *) echo "Unsupported Mac architecture"; exit 1 ;; esac
RUNTIME="$INSTALL_DIR/runtime"
if [ ! -x "$RUNTIME/bin/node" ]; then
  echo "Preparing Frameflow. Downloading the official Node.js runtime..."
  TEMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TEMP_DIR"' EXIT
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$TEMP_DIR/SHASUMS256.txt"
  FILE="$(awk -v arch="$ARCH" '$2 ~ ("^node-v22[.][0-9]+[.][0-9]+-darwin-" arch "[.]tar[.]gz$") { print $2; exit }' "$TEMP_DIR/SHASUMS256.txt")"
  test -n "$FILE"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/latest-v22.x/$FILE" -o "$TEMP_DIR/$FILE"
  EXPECTED="$(awk -v file="$FILE" '$2 == file { print $1 }' "$TEMP_DIR/SHASUMS256.txt")"
  ACTUAL="$(shasum -a 256 "$TEMP_DIR/$FILE" | awk '{ print $1 }')"
  test "$EXPECTED" = "$ACTUAL" || { echo "Runtime checksum failed"; exit 1; }
  mkdir -p "$RUNTIME"
  tar -xzf "$TEMP_DIR/$FILE" --strip-components=1 -C "$RUNTIME"
fi
"$RUNTIME/bin/node" "$INSTALL_DIR/setup-bootstrap.js"
`;
}
function windowsLauncher() {
  const ps = `$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; ` +
    `$source=Get-Location; $dest=Join-Path $env:LOCALAPPDATA 'FrameflowBridge'; if($env:FRAMEFLOW_SETUP_DIR){$dest=$env:FRAMEFLOW_SETUP_DIR}; New-Item -ItemType Directory -Force -Path $dest | Out-Null; Copy-Item (Join-Path $source 'bridge\\*.js') $dest -Force; Copy-Item (Join-Path $source 'site.json') $dest -Force; ` +
    `$runtime=Join-Path $dest 'runtime'; $node=Join-Path $runtime 'node.exe'; if(!(Test-Path $node)){ Write-Host 'Preparing Frameflow. Downloading the official Node.js runtime...'; $arch=if($env:PROCESSOR_ARCHITECTURE -eq 'ARM64'){'arm64'}else{'x64'}; $base='https://nodejs.org/dist/latest-v22.x/'; $sums=(Invoke-WebRequest -UseBasicParsing ($base+'SHASUMS256.txt')).Content; $pattern='(?m)^([a-f0-9]{64})\\s+(node-v22\\.\\d+\\.\\d+-win-'+$arch+'\\.zip)\\r?$'; $match=[regex]::Match($sums,$pattern); if(!$match.Success){throw 'Runtime checksum entry unavailable'}; $temp=Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString()); New-Item -ItemType Directory -Path $temp | Out-Null; try{$archive=Join-Path $temp 'node.zip'; Invoke-WebRequest -UseBasicParsing ($base+$match.Groups[2].Value) -OutFile $archive; if((Get-FileHash $archive -Algorithm SHA256).Hash.ToLower() -ne $match.Groups[1].Value){throw 'Runtime checksum failed'}; Expand-Archive $archive (Join-Path $temp 'unpacked'); $folder=Get-ChildItem (Join-Path $temp 'unpacked') -Directory | Select-Object -First 1; New-Item -ItemType Directory -Force -Path $runtime | Out-Null; Copy-Item (Join-Path $folder.FullName '*') $runtime -Recurse -Force}finally{Remove-Item $temp -Recurse -Force}}; & $node (Join-Path $dest 'setup-bootstrap.js'); if($LASTEXITCODE -ne 0){throw 'Bridge setup failed'};`;
  const encoded = Buffer.from(ps, 'utf16le').toString('base64');
  return `@echo off\r\ncd /d "%~dp0"\r\npowershell.exe -NoProfile -EncodedCommand ${encoded}\r\nif errorlevel 1 (echo Setup failed. Please share this message with the tester administrator. & pause)\r\n`;
}
function buildInstaller(sources, platform, origin) {
  const { setupOrigin } = require('./setup-bootstrap');
  origin = setupOrigin(origin);
  if (!['mac', 'windows'].includes(platform)) throw new Error('Unsupported setup platform');
  const entries = SOURCES.map(name => {
    if (!Buffer.isBuffer(sources[name])) throw new Error('Missing Bridge source');
    return { name: `Frameflow-Setup/bridge/${name}`, data: sources[name] };
  });
  entries.push({ name: 'Frameflow-Setup/site.json', data: JSON.stringify({ origin }) });
  entries.push({ name: `Frameflow-Setup/${platform === 'mac' ? 'Start.command' : 'Start.cmd'}`, data: platform === 'mac' ? macLauncher() : windowsLauncher(), executable: platform === 'mac' });
  entries.push({ name: 'Frameflow-Setup/README.txt', data: 'Extract this ZIP, then double-click Start.command (Mac) or Start.cmd (Windows). Frameflow prepares its private Node.js runtime and opens the website with local connection settings filled in. No administrator access is needed. Keep the setup file to reconnect after restarting your computer. Do not run setup files from an untrusted website. macOS or Windows may request confirmation before opening this downloaded script. The website cannot accept operating system security prompts for you.\n' });
  return zip(entries);
}
module.exports = { buildInstaller, zip, crc32, macLauncher, windowsLauncher, SOURCES };
