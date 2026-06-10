# OverlayChat

Browser-based audience predictions and live chat for sports streams. Viewers open a public URL, submit their score prediction and winner pick, and chat in real time. The overlay page can be used directly as a browser source, and the repo now also includes a Windows desktop overlay app.

## Included web pages

- `index.html`: audience page for predictions and chat
- `overlay.html`: browser-based stream overlay
- `host.html`: host controls for match setup and room reset

All three pages are room-based. Use `?room=your-room-name` on the URL so one host, one audience page, and one overlay page all listen to the same match room.

## Included Windows app

The `desktop/` app is an Electron wrapper around the hosted overlay:

- transparent always-on-top overlay window
- draggable native window
- room switcher
- opacity control
- click-through toggle for mouse passthrough

### Run the desktop app

```bash
npm install
npm run start
```

### Build a Windows `.exe`

```bash
npm run dist:win
```

The app opens a small control window and, by default, an overlay window that loads:

- `https://overlaychat-6f3c1.web.app/overlay.html?room=ipl-main&mode=desktop`

Keyboard shortcuts inside the desktop app:

- `Ctrl+Shift+X`: toggle click-through
- `Ctrl+Shift+O`: show overlay window

## Firebase

The current Firebase project is `overlaychat-6f3c1`. Realtime Database rules are currently open for prototype testing in `database.rules.json`.

## Hosted URLs

- Host: `https://overlaychat-6f3c1.web.app/host.html?room=ipl-main`
- Audience: `https://overlaychat-6f3c1.web.app/index.html?room=ipl-main`
- Overlay: `https://overlaychat-6f3c1.web.app/overlay.html?room=ipl-main`

## Recommended next production step

Before you put this in front of a real audience, add:

- Firebase Anonymous Auth
- write limits and validation rules
- chat moderation or blocked words
- rate limiting for spam protection
- optional host approval before messages appear on overlay
