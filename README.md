# Living Room Trivia

A local, TV-friendly trivia game with a relaxed free-play mode, an optional solo phone controller, and real-time phone buzzers for two-team play. Questions come from [The Trivia API](https://the-trivia-api.com/); no API key or database is required.

## Run locally

Requirements: Node.js 20.19 or newer and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:5173` on the host laptop. Free Play offers an optional solo-controller QR code. In team mode, the lobby displays one required QR code per team. Connect phones to the same Wi-Fi network as the laptop, then scan the codes.

If the detected LAN address is not reachable, edit the **Phone-accessible address** field in the lobby. Firewalls or guest Wi-Fi client isolation can prevent phones from reaching the laptop.

## Production build

```bash
npm run build
npm start
```

The production server listens on port `3000` and prints its localhost and LAN addresses. Set `PORT` to use a different port.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

The server owns timers, answer keys, buzz arbitration, steals, and scoring. Active games are intentionally held only in memory; preferences are stored in the host browser's local storage.
# TriviaGame
