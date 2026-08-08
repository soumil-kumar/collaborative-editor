const url = require('url');
const { verifyTokenWS } = require('../middleware/auth');
const { joinRoom, leaveRoom, getRoomUsers, broadcast, broadcastAll } = require('../rooms/manager');
const { runCode } = require('../execution/sandbox');

/**
 * Called once per incoming WebSocket upgrade request.
 * Authenticates the user via JWT query param, joins the room,
 * and sets up message handlers.
 */
function handleConnection(ws, req) {
  // --- 1. Authenticate via JWT in query string ---
  const query = url.parse(req.url, true).query;
  const { token, roomId, language } = query;

  let user;
  try {
    user = verifyTokenWS(token);
  } catch (err) {
    ws.close(4001, 'Unauthorized: invalid or missing token');
    return;
  }

  if (!roomId) {
    ws.close(4002, 'Bad request: roomId is required');
    return;
  }

  // --- 2. Join room and sync current document state ---
  const room = joinRoom(roomId, ws, { userId: user.userId, username: user.username }, language || 'python');
  const snapshot = room.document.getSnapshot();

  // Send the full current document to the newly joined client
  ws.send(JSON.stringify({
    type: 'sync',
    content: snapshot.content,
    version: snapshot.version,
    language: room.language,
    users: getRoomUsers(roomId),
  }));

  // Notify others that a new user joined
  broadcast(room, ws, {
    type: 'user_joined',
    username: user.username,
    users: getRoomUsers(roomId),
  });

  console.log(`[ws] ${user.username} joined room ${roomId} (v${snapshot.version})`);

  // --- 3. Message handler ---
  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    switch (msg.type) {
      case 'op': {
        // Client sends: { type: 'op', op: {type, position, text/length}, baseVersion: number }
        const { op, baseVersion } = msg;
        if (!op || typeof baseVersion !== 'number') {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid op message' }));
          return;
        }

        const transformed = room.document.applyClientOp(op, baseVersion);
        if (!transformed) {
          // No-op after transformation — just ack with current version
          ws.send(JSON.stringify({ type: 'ack', version: room.document.version }));
          return;
        }

        // Ack sender with new version
        ws.send(JSON.stringify({ type: 'ack', version: room.document.version }));

        // Broadcast transformed op to all other clients
        broadcast(room, ws, {
          type: 'op',
          op: transformed,
          version: room.document.version,
          username: user.username,
        });
        break;
      }

      case 'language_change': {
        // Client asks to change the language for this room
        const { language: newLang } = msg;
        const supported = ['python', 'javascript', 'cpp', 'go'];
        if (!supported.includes(newLang)) {
          ws.send(JSON.stringify({ type: 'error', message: `Unsupported language: ${newLang}` }));
          return;
        }
        room.language = newLang;
        broadcastAll(room, { type: 'language_change', language: newLang, changedBy: user.username });
        break;
      }

      case 'exec': {
        // Client triggers code execution
        const code = room.document.getSnapshot().content;
        const lang = msg.language || room.language;

        // Notify all clients that execution is starting
        broadcastAll(room, { type: 'exec_start', triggeredBy: user.username });

        try {
          const result = await runCode(lang, code);
          broadcastAll(room, {
            type: 'exec_result',
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            executionTime: result.executionTime,
            language: lang,
          });
        } catch (err) {
          broadcastAll(room, {
            type: 'exec_result',
            stdout: '',
            stderr: `Execution error: ${err.message}`,
            exitCode: -1,
            executionTime: 0,
            language: lang,
          });
        }
        break;
      }

      default:
        ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }));
    }
  });

  // --- 4. Disconnect handler ---
  ws.on('close', () => {
    leaveRoom(roomId, ws);
    const remainingRoom = require('../rooms/manager').getOrCreateRoom;
    // Notify surviving clients
    broadcast(room, ws, {
      type: 'user_left',
      username: user.username,
      users: getRoomUsers(roomId),
    });
    console.log(`[ws] ${user.username} left room ${roomId}`);
  });

  ws.on('error', (err) => {
    console.error(`[ws] error for ${user.username} in room ${roomId}:`, err.message);
  });
}

module.exports = { handleConnection };
