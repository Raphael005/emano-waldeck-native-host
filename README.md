# emano.waldeck — Native Messaging Host

A Node.js native messaging host that bridges browser extensions to the local system via the [Chrome Native Messaging protocol](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

**Version:** 0.1.7

---

## Requirements

- **macOS** (the installer targets macOS; browser manifest paths are macOS-specific)
- **Node.js** v6 or later (the installer detects and uses the system Node, or falls back to a bundled binary)

---

## Installation

Download the macOS installer package and run the install script from its directory:

```bash
bash ~/Downloads/mac/install.sh
```

The installer will:

1. Detect your system Node.js (requires v6+).
2. Create the host directory at `~/.config/emano.waldeck/` and copy the host files there.
3. Register the native messaging manifest for each supported browser by writing a JSON file into that browser's `NativeMessagingHosts` directory.

### Registered browsers

| Browser | Manifest location |
|---|---|
| Chrome | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/emano.waldeck.json` |
| Chromium | `~/Library/Application Support/Chromium/NativeMessagingHosts/emano.waldeck.json` |
| Vivaldi | `~/Library/Application Support/Vivaldi/NativeMessagingHosts/emano.waldeck.json` |
| Firefox | `~/Library/Application Support/Mozilla/NativeMessagingHosts/emano.waldeck.json` |

### Verify the installation

After running the installer, confirm the host files are in place:

```bash
ls ~/.config/emano.waldeck/
# config.js  host.js  messaging.js  run.sh  test.js
```

And that a browser manifest was registered (Chrome shown here):

```bash
cat ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/emano.waldeck.json
```

---

## File overview

| File | Purpose |
|---|---|
| `run.sh` | Entry point invoked by the browser — launches `host.js` with Node |
| `host.js` | Main host logic: reads requests, executes them, writes responses |
| `messaging.js` | Stream transforms implementing the 4-byte-length-prefix framing protocol |
| `config.js` | Version constant and allowed extension IDs for Chrome and Firefox |
| `test.js` | End-to-end test script (see [Testing](#testing)) |

---

## Protocol

The native messaging protocol frames every message as:

```
[ 4 bytes: message length, little-endian uint32 ][ N bytes: UTF-8 JSON payload ]
```

### Request types

**Spec** — returns host metadata (version, platform, Node.js versions, environment):

```json
{ "method": "spec" }
```

**Script** — executes a sandboxed JavaScript snippet. The sandbox exposes `push(obj)` to send response frames and `close()` to end the stream. Access to Node built-in modules is controlled by the `permissions` array:

```json
{
  "script": "push({ result: require('os').platform() }); close();",
  "permissions": ["os"],
  "args": { "anyKey": "anyValue" }
}
```

The sandbox provides these globals: `version`, `env`, `push`, `close`, `setTimeout`, `args`, and a permission-gated `require`.

### Response

Each call to `push(obj)` in the script emits one framed JSON response. The connection closes after `close()` is called or the script finishes.

---

## Testing

Run the end-to-end test suite against a live host process:

```bash
node ~/.config/emano.waldeck/test.js
```

Expected output:

```
native-messaging end-to-end tests

  ✓  spec request returns version and platform
  ✓  script execution: arithmetic result
  ✓  script execution: args forwarded into sandbox
  ✓  script execution: version available in sandbox
  ✓  script execution: require denied without permission
  ✓  script execution: require granted with permission
  ✓  missing script key returns error response
  ✓  script execution: multiple push() calls return multiple frames

8/8 tests passed
```

### What the tests cover

| Test | What it validates |
|---|---|
| `spec` handshake | Version format, platform, arch, tmpdir, path separator |
| Script arithmetic | Basic sandboxed JS execution via `push()` |
| Args forwarding | `args` object is available inside the sandbox |
| Sandbox `version` | Host version constant is exposed to scripts |
| `require` denied | Returns `null` for modules not listed in `permissions` |
| `require` granted | Module loads correctly when listed in `permissions` |
| Unknown method | Returns `{type:"context", error:...}` for unrecognised requests |
| Multiple frames | Multiple `push()` calls produce multiple framed response messages |

---

## Allowed extensions

### Chrome / Chromium / Vivaldi

| Extension | ID |
|---|---|
| Play in VLC (Chrome) | `cjjiafgjjkoonchbncbebpghoojakbgm` |
| Play in VLC (Opera) | `enlgmhpfbiaifddipblnamdjenddgiih` |
| Play in VLC (Chrome alt) | `idnmjmlfpkomkdfhcdmndlnodilkgfbk` |
| Play in PotPlayer | `alhflifmgbhjpbmjeliahgaoleoahoej` |
| Download by IDM | `lgbipmmmnjifkiiikaffhceflifbmhib` |
| Download by FDM | `kbeogbbnlbfcpdnfbcaljdbbipfdaokh` |

### Firefox

| Extension | ID |
|---|---|
| Play in VLC | `{ff83c451-2c38-4ae9-baf0-7181faad4ee8}` |
| Play in KMPlayer | `{16c3afcb-bef7-4dd7-8773-1c59b99bee86}` |
| Play in PotPlayer | `{0b5e9347-1495-4916-ba44-f3b367827c3f}` |
| Download by IDM | `{165e553c-8c91-4d66-8f47-1e60295562d3}` |
| Download by FDM | `{f58cf83a-497b-4f4b-a8ee-13d70fad1fe5}` |
