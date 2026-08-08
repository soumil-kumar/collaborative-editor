const { v4: uuidv4 } = require('uuid');
const { DocumentState } = require('../ot/engine');

/**
 * In-memory Room store.
 * Room: {
 *   roomId, name, language, document: DocumentState,
 *   clients: Map<ws, { userId, username }>
 * }
 */
const rooms = new Map();

/**
 * Get or create a room by ID.
 */
function getOrCreateRoom(roomId, language = 'python') {
  if (!rooms.has(roomId)) {
    const starterCode = getStarterCode(language);
    rooms.set(roomId, {
      roomId,
      language,
      document: new DocumentState(starterCode),
      clients: new Map(), // ws -> { userId, username }
    });
  }
  return rooms.get(roomId);
}

/**
 * Add a WebSocket client to a room. Returns the room.
 */
function joinRoom(roomId, ws, user, language = 'python') {
  const room = getOrCreateRoom(roomId, language);
  room.clients.set(ws, user);
  return room;
}

/**
 * Remove a client from a room. Deletes the room if empty.
 */
function leaveRoom(roomId, ws) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.clients.delete(ws);
  if (room.clients.size === 0) {
    rooms.delete(roomId);
  }
}

/**
 * Get list of users currently in a room (for broadcasting presence).
 */
function getRoomUsers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.clients.values()).map(u => u.username);
}

/**
 * Broadcast a JSON message to all clients in a room except the sender.
 */
function broadcast(room, senderWs, message) {
  const data = JSON.stringify(message);
  for (const [ws] of room.clients) {
    if (ws !== senderWs && ws.readyState === 1 /* OPEN */) {
      ws.send(data);
    }
  }
}

/**
 * Broadcast to ALL clients in a room including sender.
 */
function broadcastAll(room, message) {
  const data = JSON.stringify(message);
  for (const [ws] of room.clients) {
    if (ws.readyState === 1) {
      ws.send(data);
    }
  }
}

function getStarterCode(language) {
  const starters = {
    python: '# Welcome to the collaborative editor!\nprint("Hello, World!")\n',
    javascript: '// Welcome to the collaborative editor!\nconsole.log("Hello, World!");\n',
    cpp: '#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!" << std::endl;\n    return 0;\n}\n',
    go: 'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello, World!")\n}\n',
  };
  return starters[language] || starters['python'];
}

module.exports = { getOrCreateRoom, joinRoom, leaveRoom, getRoomUsers, broadcast, broadcastAll };
