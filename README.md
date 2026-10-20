# Pipette — Keychron Edition

<p align="center">
  <img width="1200" alt="Pipette keymap editor" src="docs/screenshots/layer-panel-collapsed.png" />
</p>

<p align="center">
  <a href="https://pipette.tymon3310.dev"><img alt="Web app" src="https://img.shields.io/badge/Web_App-pipette.tymon3310.dev-007ACC?style=flat&logo=googlechrome&logoColor=white"></a>
  <a href="https://github.com/tymon3310/pipette-desktop/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/tymon3310/pipette-desktop?style=flat"></a>
  <a href="https://aur.archlinux.org/packages/pipette-desktop-keychron-bin"><img alt="AUR" src="https://img.shields.io/aur/version/pipette-desktop-keychron-bin?style=flat&logo=archlinux&logoColor=white"></a>
  <a href="LICENSE"><img alt="License: GPL-3.0-or-later" src="https://img.shields.io/badge/License-GPL--3.0--or--later-blue?style=flat"></a>
</p>

A keymap editor for [Vial](https://get.vial.today/) keyboards with full support for **Keychron** and **Lemokey** boards: Keychron's own settings, per-key RGB, Snap Click, Hall Effect (analog) keyboards, firmware flashing, and editing over the **2.4 GHz Keychron Link** receiver.

It is a fork of [darakuneko/pipette-desktop](https://github.com/darakuneko/pipette-desktop) and keeps every upstream feature. It is part of the [Keychron Vial project](https://github.com/tymon3310/keychron-vial), which also has the firmware and the [list of supported keyboards](https://github.com/tymon3310/keychron-vial#supported-keyboards).

## Contents

- [What this fork adds](#what-this-fork-adds)
- [Get Pipette](#get-pipette)
- [Updating](#updating)
- [Upgrading from 0.5.x](#upgrading-from-05x)
- [Using Pipette](#using-pipette)
- [Platform notes](#platform-notes)
- [All features](#all-features)
- [Reporting problems](#reporting-problems)
- [Development](#development)
- [Architecture](#architecture)
- [Data & Privacy](#data--privacy)
- [Contributing](#contributing)
- [Acknowledgments](#acknowledgments)
- [License](#license)

## What this fork adds

<p align="center">
  <img width="1000" alt="Keychron Settings" src="docs/screenshots/keychron-settings.png" />
</p>

| Feature | What you can do |
|---|---|
| **Keychron Settings** | Debounce algorithm and time, NKRO, USB / 2.4 GHz report rate (up to 8000 Hz on 8K boards), wireless sleep timers |
| **Keychron RGB** | Global effects, per-key colours, mixed (per-region) RGB, colours and on/off for the Caps / Num / Scroll Lock indicators |
| **Snap Click (SOCD)** | Opposite-direction key pairs (A + D, W + S, …) with last-input, first-key, neutral and other resolution modes |
| **Hall Effect** | Named profiles; global or per-key actuation point; Rapid Trigger with separate press / release sensitivity; Dynamic Keystroke (DKS), toggle and gamepad keys; analog SOCD; calibration and a live travel view |
| **2.4 GHz editing** | Edit a keyboard connected through the Keychron Link receiver exactly like a wired one |
| **Firmware flasher** | Flash Keychron firmware from inside Pipette; your Keychron settings are kept |
| **Export / import** | `.vil` and `.pipette` files also carry the RGB, Keychron and Hall Effect settings |

Find the buttons in the keymap editor's footer: **Behavior** tab → *Keychron*, *Snap Click (SOCD)*, *Keychron HE*; **Lighting** tab → *Keychron RGB*; **System** tab → *Keychron Flasher*. They appear only when the connected keyboard supports them.

The keyboard needs the Keychron Vial firmware from [tymon3310/vial-qmk](https://github.com/tymon3310/vial-qmk).

## Get Pipette

### Web app — nothing to install

👉 **[pipette.tymon3310.dev](https://pipette.tymon3310.dev)** in Chrome, Edge, Brave, Opera or another Chromium browser (they have WebHID and WebUSB; Firefox and Safari do not). It has the same Keychron features as the desktop app, over USB and the 2.4 GHz receiver, and is always the latest version.

### Desktop app

| System | Download |
|---|---|
| Windows 10 / 11 (x64) | [Pipette-win-x64.exe](https://github.com/tymon3310/pipette-desktop/releases/latest/download/Pipette-win-x64.exe) |
| macOS 12+ on Apple Silicon | [Pipette-mac-arm64.dmg](https://github.com/tymon3310/pipette-desktop/releases/latest/download/Pipette-mac-arm64.dmg) |
| macOS 12+ on Intel | [Pipette-mac-x64.dmg](https://github.com/tymon3310/pipette-desktop/releases/latest/download/Pipette-mac-x64.dmg) |
| Linux (x86_64) | [Pipette-linux-x86_64.AppImage](https://github.com/tymon3310/pipette-desktop/releases/latest/download/Pipette-linux-x86_64.AppImage) |
| Arch Linux | AUR: [`pipette-desktop-keychron-bin`](https://aur.archlinux.org/packages/pipette-desktop-keychron-bin) (release build) or [`pipette-desktop-keychron-git`](https://aur.archlinux.org/packages/pipette-desktop-keychron-git) (built from the latest source) |

**Windows** — run the installer. It installs for your user only (no administrator rights) into `%LOCALAPPDATA%\Pipette`. The installer is not code-signed, so SmartScreen may warn: choose **More info › Run anyway**. Pipette uses the Edge WebView2 runtime that comes with Windows; if it is missing, the installer downloads it.

**macOS** — open the `.dmg` and drag **Pipette** into **Applications**. This fork's app is not notarized by Apple, so the first time right-click Pipette and choose **Open** (or run `xattr -dr com.apple.quarantine /Applications/Pipette.app`). Always start it from Applications, not from the disk image.

**Linux AppImage** — `chmod +x Pipette-linux-x86_64.AppImage` and run it. No `libfuse2` is needed. Install the [udev rule](#linux) so Pipette can reach your keyboard.

**Arch Linux** — `yay -S pipette-desktop-keychron-bin` (or your AUR helper). The package uses the system WebKitGTK and installs the udev rule for you.

To flash firmware, the desktop app needs [dfu-util](https://dfu-util.sourceforge.net/) installed and on `PATH` (Arch: `pacman -S dfu-util`, macOS: `brew install dfu-util`). The web app flashes over WebUSB and needs nothing extra.

## Updating

| How you installed | How it updates |
|---|---|
| Windows installer, macOS app in Applications, AppImage | Pipette checks for a new version at startup and offers **Update**, **Not now** or **Skip this version**; Settings → About → **Check for updates** checks any time. |
| AUR | Never updates itself — update with your AUR helper (`yay -Syu`). |
| Web app | Always the latest version. |

- Updates come only from this fork's releases, never from upstream Pipette, and each one is verified with this fork's signing key before it is installed. Pipette saves your work, installs the update and starts again.
- If an update fails, nothing is lost: download the new version from the [releases page](https://github.com/tymon3310/pipette-desktop/releases) and install it over the old one.
- The AppImage is replaced where it is, so it must be in a folder you can write to; an extracted AppImage does not update itself. A beta gets betas and releases; a release gets releases only.

## Upgrading from 0.5.x

Version 0.6 is the same app rebuilt on [Tauri](https://tauri.app/) instead of Electron (upstream Pipette 0.5). It opens your existing data folder in place, without copying or converting it, and the sync format is unchanged.

**Before you install**

1. Quit Pipette 0.5.x from the tray menu (**Quit**), not just the window. Finish a sync password change first if one is unfinished.
2. Back up your data folder (and note whether **Launch at Login** is on):

| System | Data folder | Autostart entry |
|---|---|---|
| Windows | `%APPDATA%\pipette-desktop` | `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` |
| macOS | `~/Library/Application Support/pipette-desktop` | Login item |
| Linux | `~/.config/pipette-desktop` | `~/.config/autostart/pipette.desktop` |

There is no supported way back to 0.5.x; the backup is the safety net.

**After the first start**

- Sign in to Google again (Settings › Connect › Google Account › **Connect**) and enter your sync password again: sign-in data is now kept in the OS key store and the old files are not read. Unsynced changes are uploaded once you sign in with the same account.
- **Launch at Login** carries over.
- Do not run 0.5.x and 0.6 at the same time; 0.6 refuses to start while 0.5.x is running.
- **Windows:** the installer removes 0.5.x for your user and keeps the data folder. If 0.5.x was installed for all users, uninstall it from **Settings › Apps** first. Taskbar pins are lost.
- **macOS 12:** a login item registered by 0.5.x keeps working, but turning **Launch at Login** off cannot remove it — remove it in System Settings.
- **Linux:** existing udev rules keep working. Proxy settings come from `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`.

## Using Pipette

1. Connect the keyboard with a USB cable — or plug in the Keychron Link receiver and switch the keyboard to 2.4 GHz.
2. Start Pipette and pick the keyboard. A keyboard on the receiver is listed with **[2.4 GHz]** after its name.
3. Choose a layer and click a key to change it. Changes are written to the keyboard at once.
4. Unlock the keyboard (Esc + Enter on Keychron boards) when Pipette asks, before changing protected settings.

The window needs at least **1280×1024** (1440×1024 by default); on smaller screens it is fitted to the visible area. The [Operation Guide](https://darakuneko.github.io/pipette-desktop/guide.html) explains every screen with screenshots.

## Platform notes

### Linux

#### udev rule

Pipette needs access to the keyboard's HID interface. The AUR packages install a rule for you; for the AppImage:

```bash
sudo cp scripts/99-vial.rules /etc/udev/rules.d/60-vial.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
```

`scripts/99-vial.rules` is in this repository; the AppImage also carries a copy at `usr/lib/Pipette/udev/99-vial.rules`. (The rule uses `uaccess`, which only takes effect from a file numbered below 73.)

#### Monitor App on Wayland (GNOME Shell extension)

The typing-view Monitor App toggle tags each minute of recording with the active application name. X11 exposes the focused window directly, but on Wayland the desktop sandboxes window focus, so Pipette falls back to a GNOME Shell extension.

To enable Monitor App on Wayland, install the **Focused Window D-Bus** GNOME Shell extension:

https://extensions.gnome.org/extension/5592/focused-window-d-bus/

Without the extension Monitor App silently records `null` for every minute on Wayland — keystroke counts still flow to the analytics, but per-app breakdowns are unavailable. Compositors other than GNOME Shell (KDE Plasma, Sway, etc.) are not currently supported; each would need its own focus-bridge implementation.

### macOS

#### Monitor App

The typing-view Monitor App toggle reads the name of the frontmost application, which normally works without any permission on macOS. If the application name does not appear (macOS behaviour can change between versions), allowing Pipette in **System Settings → Privacy & Security → Accessibility** may help.

#### Launch at Login on macOS 12

On macOS 13 and later, **Launch at Login** registers Pipette as a login item and removes it again when turned off. On macOS 12 Pipette does not register a login item itself: a login item that Pipette 0.5.x registered keeps starting Pipette, but turning **Launch at Login** off cannot remove it. Remove it in the system settings yourself.

## All features

### Feature Availability

| Feature | No Integration | Google Account Integration |
|---|:---:|:---:|
| Keymap / macro / tap-dance / combo / key-override / alt-repeat editing | ✅ | ✅ |
| RGB lighting · QMK settings · Matrix tester | ✅ | ✅ |
| Snapshots & Favorites (local save / load) | ✅ | ✅ |
| Import / Export (`.vil` · `.pipette` · `keymap.c` · PDF) | ✅ | ✅ |
| Offline editing (`.pipette` without a keyboard) | ✅ | ✅ |
| Typing Test & Typing View | ✅ | ✅ |
| Analyze — typing analytics (heatmaps · ergonomics · bigrams · layout comparison · per-app) | ✅ | ✅ |
| Download community language / theme / key-label packs from Hub | ✅ | ✅ |
| Cloud Sync — snapshots / favorites / settings across devices | ❌ | ✅ |
| Download remote-only keyboards on demand | ❌ | ✅ |
| Sync typing analytics across devices | ❌ | ✅ |
| Share keymaps to Hub | ❌ | ✅ (Hub) |
| Share favorites (tap dance · macro · combo · …) to Hub | ❌ | ✅ (Hub) |
| Share typing analytics to Hub | ❌ | ✅ (Hub) |
| Publish your own language / theme / key-label packs | ❌ | ✅ (Hub) |

> **Pipette Hub requires a connected Google account.** Rows marked **(Hub)** need Hub connected (set a Display Name in Settings → Data) in addition to Google sign-in. Cloud Sync also needs a sync encryption password. **Downloading community packs from Hub needs no sign-in at all.**

### Keyboard Configuration

- **Keymap Editor** — Layer-based key assignment with drag & drop, auto-advance, and a searchable keycode palette with Mod Mask/Mod-Tap wrapper modes. Basic tab supports ANSI, ISO, JIS, and List views with International (INT1–5) and Language (LANG1–5) keycode groups. Reorganized key picker tabs (System, Behavior, dedicated Combo/Key Override/Alt Repeat Key tabs) with instant key selection. Keymap change history with undo/redo via toolbar buttons, keyboard shortcuts (Ctrl/Cmd+Z, Ctrl+Y/Ctrl/Cmd+Shift+Z), and popover undo/redo. Key popover includes a layer switching sidebar for quick layer navigation without closing the popover
- **Layout Editor** — Physical layout switching via slide-out panel (split backspace, bottom row variants, etc.)
- **Tap Dance** — Multi-tap key behaviors (tap, hold, double-tap, tap+hold, custom tapping term) with inline favorites
- **Combo** — Simultaneous key-press to trigger output keys; inline tile grid with detail editor modal and inline favorites
- **Key Override** — Replace key output when specific modifiers are held; inline tile grid with detail editor modal and inline favorites
- **Alternate Repeat Key** — Context-aware alternate repeat key bindings; inline tile grid with detail editor modal and inline favorites
- **Macro Editor** — Create and record macros with text, tap, hold, release, and delay actions (v1/v2 protocol) with inline favorites
- **RGB Lighting** — QMK Backlight, RGBLight, and VialRGB configuration
- **QMK Settings** — Dynamic firmware settings with boolean/integer fields
- **Matrix Tester** — Real-time key switch verification (20 ms polling)

### Data Management

- **Snapshots** — Save and restore complete keyboard states (keymap, macros, dynamic entries, QMK settings)
- **Favorites** — Inline favorites panel in every editor for saving/loading reusable configurations; not tied to a specific keyboard, so saved entries can be loaded on any compatible keyboard. Per-entry export, bulk import/export supported. Individual favorites can be uploaded to Pipette Hub
- **Data Modal** — Centralized favorite and Hub post management from the device selection screen
- **Export** — Download keymap as `.vil`, `.pipette`, `keymap.c`, PDF keymap cheat sheet, or PDF layout export (key outlines with summary pages for dynamic entries)
- **Import** — Load `.vil` files to restore keyboard state
- **Offline Editing** — Edit `.pipette` files without a physical keyboard connected; uses the embedded keyboard definition for a virtual layout

### Cloud Sync (Google Drive appDataFolder)

Sync your snapshots, favorites, and per-keyboard settings across devices via [Google Drive appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata).  \
The appDataFolder is **not** regular Google Drive storage — it is a hidden, app-specific folder that only Pipette can access. Your personal Drive files are never touched.

See [Data Guide](https://darakuneko.github.io/pipette-desktop/guide.html#data) for details on what is synced and how your data is protected.

### Pipette Hub

Upload and share your keymaps and favorite configurations on [Pipette Hub](https://pipette-hub-worker.keymaps.workers.dev), a community keymap gallery. Keyboard snapshots, tap dance, macro, combo, key override, and alt repeat key configurations can all be shared.

See [Data Guide](https://darakuneko.github.io/pipette-desktop/guide.html#data) for details on how Hub authentication works.

### Utilities

- **Typing Test** — Built-in typing test with WPM/accuracy tracking, downloadable language packs, and per-keyboard history
- **Typing View** — View-only mode displaying only the keyboard layout in a compact, resizable window with always-on-top support — ideal for overlaying on other applications
- **Multilingual UI** — Multiple languages supported via importable language packs; manage, import, and download packs from Pipette Hub in Settings → Tools → Language Packs
- **Light / Dark / System theme** with importable **Theme Packs** — download community colour schemes from Pipette Hub or author your own `.json` pack
- **Keyboard layout override** (QWERTY, Dvorak, etc.) for correct label display
- **Configurable panel side** (left / right)
- **Auto-lock timer**

## Reporting problems

Keychron support is tested on a **V5 Max ANSI Encoder**. If something does not work on another keyboard, please [open an issue](https://github.com/tymon3310/pipette-desktop/issues) with the keyboard model, the firmware version (Keychron Settings shows it) and, if you can, the log: `logs/pipette-0.log` in the data folder. Start Pipette with `VIAL_DEBUG_HID=1` to log every HID packet.

## Development

### Prerequisites

- Node.js 24 and pnpm (the version in `package.json`'s `packageManager`; `corepack pnpm` picks it)
- Rust (the toolchain in `src-tauri/rust-toolchain.toml`, installed by rustup)
- On Linux, the libraries Tauri and hidapi build against, e.g. on Ubuntu:

  ```bash
  sudo apt-get install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev patchelf libudev-dev libdbus-1-dev
  ```

### Commands

```bash
pnpm install        # Install dependencies
pnpm dev            # Run the app with the development tools (Vite dev server + Tauri)
pnpm build          # Release build and installer for this OS (src-tauri/target/release/bundle/)
pnpm build:debug    # Debug build with the development tools, no installer (for the e2e tests)
pnpm test           # Vitest
pnpm test:watch     # Vitest (watch mode)
pnpm lint           # ESLint
pnpm typecheck      # TypeScript
pnpm format         # Prettier
pnpm test:e2e       # End-to-end tests (Linux; see below)
pnpm doc:guide      # Rebuild docs/guide.html from the Markdown docs
```

The Rust backend is a Cargo workspace in `src-tauri/`:

```bash
cd src-tauri
cargo test --workspace --features pipette-app/dev-tools
cargo clippy --workspace --all-targets --features pipette-app/dev-tools -- -D warnings
cargo fmt --all
```

### Web edition

Pipette Web is built from the same UI with `src/web/` (WebHID, WebUSB, browser storage) in place of the Tauri backend:

```bash
pnpm dev:web     # Start Vite dev server for Web
pnpm build:web   # Build static web assets into dist-web/
pnpm preview:web # Preview production web build locally
```

The end-to-end tests (`e2e-tauri/`) drive the `pnpm build:debug` app through [tauri-driver](https://crates.io/crates/tauri-driver) and WebKitWebDriver, so they run on Linux only. They use a virtual keyboard and a temporary data folder, never your own; run them under Xvfb with a session bus of their own:

```bash
pnpm build:debug
xvfb-run --auto-servernum --server-args="-screen 0 1920x1200x24" dbus-run-session -- pnpm test:e2e
```

The release builds (signed macOS app, AppImage repacked with `scripts/repack-appimage.sh`) are made by the release workflow in `.github/workflows/`.

## Architecture

Pipette is a [Tauri 2](https://tauri.app/) app: a Rust backend and a React UI in the OS WebView (WebView2 on Windows, WebKit on macOS, WebKitGTK on Linux).

```
src-tauri/          Rust backend: the app crate (src/: Tauri commands, windows, tray,
                    quit sequence, updater, Keychron DFU flasher) and the library crates
                    (crates/: HID incl. the Keychron 2.4 GHz receiver, VIA/Vial virtual
                    keyboard, stores, cloud sync, Google auth, Drive, Hub, typing
                    analytics, OS key store, autostart, ...)
src/tauri-shim/     The `window.vialAPI` the UI calls, on top of the Tauri commands;
                    the VIA/Vial and Keychron protocols over the HID transport
src/renderer/       React 19 UI (Tailwind CSS v4, i18next)
src/shared/         Types, constants, keycodes, KLE parser shared by the UI and shim
src/web/            Pipette Web: WebHID / WebUSB / browser storage in place of the backend
```

USB HID I/O runs in the backend (hidapi). The UI calls `window.vialAPI`; the shim turns each call into a Tauri command, and the commands the window may use are listed in `src-tauri/capabilities/` and `src-tauri/permissions/`.

## Data & Privacy

See the [Data Guide](https://darakuneko.github.io/pipette-desktop/guide.html) for a complete guide on what data Pipette stores, how cloud sync works, and the security measures in place for external services.

## Contributing

Contributions are welcome! In particular:

- **Translations** — Create a language pack `.json` (use the built-in English pack as a template — export it from Settings → Tools → Language Packs) and share it on [Pipette Hub](https://pipette-hub-worker.keymaps.workers.dev) or submit a PR.
  See the [Operation Guide](https://darakuneko.github.io/pipette-desktop/guide.html) §6.3 for the pack format and management workflow.
- **Theme packs** — Design a colour theme `.json` and share it on Pipette Hub.
  See the [Theme Pack Authoring Guide](https://darakuneko.github.io/pipette-desktop/guide.html#theme) for the full colour token reference and design tips.
- **Keyboard layout composite labels** — `KeyboardLayoutDef.compositeLabels` in `src/renderer/data/keyboard-layouts.ts`
  lets a layout override the label of an individual composite keycode (e.g. `LALT(KC_L)` → "Cmd L" on macOS).
  Add the full qmkId → display string mapping to the relevant layout. Reviewers must check that the
  same label is not assigned to two different composite qmkIds within one layout (label collision).
- **Bug reports & feature requests** — Open an issue to let us know.

## Acknowledgments

This fork is based on [Pipette](https://github.com/darakuneko/pipette-desktop) by [darakuneko](https://github.com/darakuneko); all of Pipette's own features are their work. Keychron support builds on Keychron's [QMK firmware](https://github.com/Keychron/qmk_firmware) and the Keychron Vial firmware of [tymon3310/vial-qmk](https://github.com/tymon3310/vial-qmk).

Pipette is built upon the foundation laid by [Vial](https://get.vial.today/) and [Vial GUI](https://github.com/vial-kb/vial-gui).
The VIA/Vial protocol implementation, keyboard definition format, and overall design philosophy originate from these projects.
We are deeply grateful to the Vial team and contributors for making open-source keyboard configuration accessible to everyone.

The Typing Test feature is based on [Monkeytype](https://github.com/monkeytypegame/monkeytype) (GPL-3.0).
Thank you to the Monkeytype team for their excellent open-source typing test.

Typing Test sentence packs are curated from the [Tatoeba Project](https://tatoeba.org) and its contributors.
Most language packs are licensed under [CC BY 2.0 FR](https://creativecommons.org/licenses/by/2.0/fr/); some packs are dedicated to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
Thank you to the Tatoeba community for building an open corpus of example sentences.

The Aozora Bunko catalog lets you type public-domain Japanese literature. Catalog metadata (titles, authors)
is derived from the official index of [Aozora Bunko](https://www.aozora.gr.jp/) and provided via Pipette Hub; work texts
are downloaded directly from Aozora Bunko, with Aozora's ruby and editorial annotation markup cleaned during import.
Thank you to the Aozora Bunko volunteers for decades of careful digitization.

## License

[GPL-3.0-or-later](LICENSE)
