# Real-account migration checks

These checks use the actual WhatsApp Web network and the application's export/import IPC. They do not inject a provider, generate messages or link an account by QR. Use an account you control. Keep the source application closed while testing a copied linked-device identity.

The private test folder holds a credential archive and target profile. Keep it outside the repository, restrict access to its owner, and remove it when testing ends. Logs contain only states, counts and salted message hashes; the archive and browser profile contain sensitive login data.

## Source Mac

```sh
HAIA_LIVE_SOURCE_PROFILE="$HOME/Library/Application Support/Relay Desk" \
HAIA_LIVE_ACCOUNT='<account UUID>' \
./node_modules/.bin/electron test/live-transfer.cjs '<private folder>' export
```

The test calls `backupExport` without a password. Transfer `transfer.haia` and `baseline.json` over a trusted connection to the target. No source profile or other files are required by the target.

## Target

With the same source revision and Electron dependencies installed:

```sh
./node_modules/.bin/electron test/live-transfer.cjs '<private folder>' import
./node_modules/.bin/electron test/live-transfer.cjs '<private folder>' restart
```

The first import requires an empty target profile. `restart` reuses that profile. Passing requires the imported account to authenticate, reach the main connected state and return actual message bodies. Source and target account hashes must match. The report distinguishes restored body matches from messages created after the export.

For a separately authorized incoming test message, set `HAIA_LIVE_EXPECT_TEXT` to its exact body. The harness does not send it. Passing then requires an incoming WhatsApp record matching the complete text, the same body in HaiA's application state, and a rendered conversation screenshot. A connected socket alone never passes this check. Reports retain salted hashes, not message bodies. The application flushes its sessions before exiting so the restart phase checks persisted data.

## Linux virtual machine environment

`Dockerfile` and `linux-entry.sh` provide an isolated Linux runtime under Docker Desktop's VM. They are a test environment, not a supported Linux distribution package. Use the host UID/GID or build an equivalent local user into the image. Mount the project read-only, the private folder as `/data`, and the image's Linux node_modules at both `/opt/haia-runtime/node_modules` and `/work/node_modules`; do not use macOS dependencies inside the VM. Pass `--no-sandbox` before the test entrypoint when running this isolated container. Limit the container's memory/CPU and do not publish ports.

A successful Linux VM check establishes actual account migration across OS environments. It does not establish physical Windows or second-Mac installation compatibility.

For a separate restart/login check, `HAIA_LIVE_AUTH_ONLY=1` stops after confirming the authenticated account identity and records `scope: authentication-only`. This is not a passing message synchronization test; the ordinary import/restart checks still require message bodies.
