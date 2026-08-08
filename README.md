# Real-Time Collaborative Code Execution Platform

A web platform where multiple users can join a shared room, collaboratively edit code in real-time (like Google Docs for code), and execute it in a sandboxed Docker container — seeing the output live together.

## Key Features

- **Real-Time Collaboration** — Multiple users edit the same document simultaneously using Operational Transform (OT) for conflict-free sync
- **Sandboxed Execution** — Code runs in isolated Docker containers with CPU/memory/PID limits and a 5-second timeout
- **JWT Authentication** — Secure register/login with bcrypt-hashed passwords
- **Leader Forwarding** — Any user in a room can trigger execution and all users see the output
- **Multi-Language Support** — Python 3, JavaScript (Node.js), C++, and Go
- **Live Presence** — See who's in your room in real-time

## Architecture

```
Client (React + Monaco)
    │
    │  WebSocket (OT ops, exec triggers)
    │  HTTP (auth REST)
    ▼
Server (Node.js + Express + ws)
    ├── Auth: JWT sign/verify, bcrypt user store
    ├── OT Engine: server-authoritative transform + history
    ├── Room Manager: in-memory rooms, client presence
    └── Execution: dockerode → isolated container per run
            │
            ▼
    Docker Sandbox (per request)
    ├── collab-python  (50MB RAM, 1 CPU, 64 PIDs, no network, 5s timeout)
    ├── collab-node
    ├── collab-cpp
    └── collab-go
```

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite |
| Code Editor | Monaco Editor (VS Code engine) |
| Real-time Sync | WebSocket (`ws`) + Operational Transform |
| Backend | Node.js + Express |
| Authentication | JWT (`jsonwebtoken`) + bcrypt |
| Execution | Docker Engine API (`dockerode`) |

## Quick Start

### Prerequisites
- Node.js 20+
- Docker Desktop running

### 1. Start the server
```bash
cd server
npm install
npm run dev
```

### 2. Start the client
```bash
cd client
npm install
npm run dev
```

### 3. Open in two browser windows
- Go to `http://localhost:5173`
- Register two accounts, create a room in one, paste the Room ID in the other
- Start typing — edits appear in real-time across both windows

### Docker (one command)
```bash
docker-compose up --build
```

## How Operational Transform Works

When two users type simultaneously:

```
Document: "Hello"
User A inserts " World" at position 5  → "Hello World"
User B (simultaneously) inserts "!" at position 5
```

Without OT, B's insert lands at position 5 → "Hello! World" (wrong).  
With OT, B's insert is **transformed** against A's insert → position 11 → "Hello World!" (correct).

The server is the single source of truth. Every client op includes a `baseVersion` — the version the client was looking at when they made the edit. The server transforms the op against all ops committed since that version, applies it, and broadcasts the transformed op.

## Security Model

Each code execution request:
1. Spins up a fresh Docker container from a pre-built minimal image
2. Mounts the code file as read-only
3. Enforces: 50MB memory cap, 1 CPU, 64 PID limit, network disabled
4. Kills the container after 5 seconds
5. Removes the container automatically (`AutoRemove: true`)

This prevents infinite loops, memory bombs, fork bombs, and network access.

## License

MIT
