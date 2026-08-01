# Fix: Electron loads web UI from local files, not server

## Problem
Electron connects to server for API (port 3001) but loads web UI from port 8000. Windows Firewall blocks Electron's outbound connection to port 8000.

## Fix
Change `main.ts` to load `dist/index.html` from the packaged app directory instead of `http://IP:8000`. API calls still use server URL from config.

## Files to modify
1. `apps/companion-electron/electron/main.ts` — change `win.loadURL(webUrl)` to `win.loadFile()`
2. Rebuild + repack

## Implementation
In `createMainWindow()`:
```javascript
// OLD:
const webUrl = serverUrl.replace(/:3001$/, ':8000');
win.loadURL(webUrl);

// NEW:
win.loadFile(path.join(__dirname, '../dist/index.html'));
```
