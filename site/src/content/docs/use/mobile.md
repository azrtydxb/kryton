---
title: Mobile
description: The React Native client for Kryton.
---

Kryton's mobile app is a React Native client (Expo SDK 55) that lives in its own repository: [azrtydxb/kryton-mobile](https://github.com/azrtydxb/kryton-mobile).

It is an online-only client — it talks to a Kryton server over REST and uses the Yjs WebSocket endpoint for real-time collaborative editing. There is no local database; the server is the source of truth. The mobile editor is the same in-house web editor wrapped in a React Native WebView, so behaviour stays in lock-step with the desktop client.

Builds are produced via EAS Build (Android APK). See the kryton-mobile repository for current build availability.
