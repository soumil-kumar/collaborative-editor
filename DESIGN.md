# Design Decisions

## 1. Operational Transform over CRDT

**Decision**: Used server-authoritative Operational Transform (OT) instead of CRDTs (like Yjs or Automerge).

**Reasoning**: CRDTs are the correct choice for peer-to-peer, offline-first, or leaderless systems (like Figma or Notion). This project uses a centralized server as the single source of truth, which is the exact use-case OT was designed for. The server receives every op, transforms it against its history, and broadcasts the resolved op — this gives us a simpler implementation with a clearer correctness argument. CRDTs would add significant complexity (tombstone tracking, vector clocks, garbage collection) without benefit for this architecture.

## 2. Raw WebSocket (`ws`) over Socket.io

**Decision**: Used the `ws` library directly instead of Socket.io.

**Reasoning**: Socket.io adds abstraction (rooms, namespaces, fallback transports, auto-reconnect) that hides how the underlying WebSocket lifecycle works. Since this project implements its own room management, reconnection backoff, and message protocol, Socket.io's abstractions would conflict with rather than help the implementation. Using raw WebSocket also demonstrates a deeper understanding of the protocol in interviews.

## 3. JWT Verified on WebSocket Upgrade, Not Per-Message

**Decision**: The JWT is extracted from the `?token=` query parameter and verified during the HTTP upgrade handshake, before the WebSocket connection is accepted.

**Reasoning**: Browser WebSocket API (`new WebSocket(url)`) does not support custom headers. The standard solution is to pass the token as a query parameter and verify it during the HTTP upgrade. This is correct and production-standard — once authenticated, the connection is trusted for its lifetime (matching the JWT expiry). Verifying on every message would be wasteful and incorrect (it would allow a request to arrive mid-message while a token is being checked).

## 4. In-Memory State (No Database)

**Decision**: User accounts and room state live in Node.js `Map` objects. No database.

**Reasoning**: A database (PostgreSQL, Redis) would add operational complexity without adding algorithmic interest. The hard problems in this project are OT transformation correctness and Docker sandbox security — not CRUD persistence. In a production system, user accounts would live in PostgreSQL and room state would live in Redis for horizontal scaling. The trade-off is documented openly.

## 5. One Docker Container Per Execution Request

**Decision**: Each code execution creates a fresh container and destroys it after completion.

**Reasoning**: Container reuse (a pool of warm containers) would be faster but introduces state leakage risks between users — a malicious user could leave files or processes that affect the next user's execution. Fresh containers guarantee isolation at the cost of startup latency (~200-400ms). For an interactive editor where users already wait 1-5 seconds for code to run, this is an acceptable trade-off. Production systems like Judge0 use container pools with careful cleanup — that optimization is called out explicitly as a known trade-off.
