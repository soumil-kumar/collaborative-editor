const express = require('express');
const http = require('http');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const authRoutes = require('./routes/auth');
const { handleConnection } = require('./ws/handler');

const PORT = process.env.PORT || 4000;

const app = express();
app.use(cors());
app.use(express.json());

// REST routes
app.use('/auth', authRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// HTTP server (shared between Express and WebSocket)
const server = http.createServer(app);

// WebSocket server — piggybacks on the same port
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  handleConnection(ws, req);
});

server.listen(PORT, () => {
  console.log(`[server] HTTP + WebSocket listening on port ${PORT}`);
  console.log(`[server] Auth:  POST http://localhost:${PORT}/auth/register`);
  console.log(`[server] Auth:  POST http://localhost:${PORT}/auth/login`);
  console.log(`[server] WS:    ws://localhost:${PORT}/ws?token=<jwt>&roomId=<id>`);
});

module.exports = { app, server };
