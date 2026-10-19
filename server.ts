import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, 'users.txt');

// ============================================================================
// C++ OOP EQUIVALENT IMPLEMENTATION: Deterministic 64-bit Salted DJB2 Hashing
// ============================================================================
function computeDJB2Hash(input: string): string {
  let hash = BigInt(5381);
  const mask64 = (BigInt(1) << BigInt(64)) - BigInt(1);
  for (let i = 0; i < input.length; i++) {
    const charCode = BigInt(input.charCodeAt(i));
    hash = (((hash << BigInt(5)) + hash) + charCode) & mask64;
  }
  return hash.toString();
}

function generateSalt(): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let salt = '';
  for (let i = 0; i < 8; i++) {
    salt += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return salt;
}

interface UserRecord {
  username: string;
  salt: string;
  passwordHash: string;
}

// In-Memory User Store (Mirrors AuthManager::userStore)
const userStore = new Map<string, UserRecord>();

function loadUsersFromFile() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      fs.writeFileSync(
        USERS_FILE,
        '# CS204 Database: username:salt:djb2_64bit_hash\n',
        'utf8'
      );
    }
    const content = fs.readFileSync(USERS_FILE, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const parts = trimmed.split(':');
      if (parts.length >= 3) {
        userStore.set(parts[0], {
          username: parts[0],
          salt: parts[1],
          passwordHash: parts[2],
        });
      }
    }
    console.log(`[AuthManager] Loaded ${userStore.size} users from users.txt`);
  } catch (err) {
    console.error('[AuthManager ERROR] Error reading users.txt:', err);
  }
}

function appendUserToFile(record: UserRecord) {
  const line = `${record.username}:${record.salt}:${record.passwordHash}\n`;
  fs.appendFileSync(USERS_FILE, line, 'utf8');
}

loadUsersFromFile();

// ============================================================================
// REST API ROUTES (Crow C++ Endpoints)
// ============================================================================
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password required.' });
  }
  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ success: false, message: 'Username must be between 3 and 20 characters.' });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ success: false, message: 'Username must be alphanumeric or underscore.' });
  }
  if (password.length < 4) {
    return res.status(400).json({ success: false, message: 'Password must be at least 4 characters.' });
  }

  if (userStore.has(username)) {
    return res.status(409).json({ success: false, message: `Username '${username}' is already registered.` });
  }

  const salt = generateSalt();
  const hash = computeDJB2Hash(password + salt);
  const record: UserRecord = { username, salt, passwordHash: hash };

  userStore.set(username, record);
  appendUserToFile(record);

  console.log(`[AuthManager] Registered new user: ${username} (salt: ${salt})`);
  return res.json({ success: true, message: 'User registered successfully.', username });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password required.' });
  }

  const record = userStore.get(username);
  if (!record) {
    return res.status(401).json({ success: false, message: 'Invalid username or password.' });
  }

  const candidateHash = computeDJB2Hash(password + record.salt);
  if (candidateHash !== record.passwordHash) {
    return res.status(401).json({ success: false, message: 'Invalid password.' });
  }

  console.log(`[AuthManager] User logged in: ${username}`);
  return res.json({ success: true, message: 'Login successful.', username });
});

// Endpoint to view raw users.txt database entries for student inspection
app.get('/api/users', (_req, res) => {
  const users = Array.from(userStore.values()).map(u => ({
    username: u.username,
    salt: u.salt,
    hash: u.passwordHash,
  }));
  res.json({ users, total: users.length, storageFile: 'users.txt' });
});

// Endpoint to read C++ files for the in-browser Academic Inspector
app.get('/api/cpp/files', (_req, res) => {
  const filePaths = [
    'include/AuthManager.h',
    'include/Board.h',
    'include/Player.h',
    'include/AIPlayer.h',
    'include/WebSocketPlayer.h',
    'include/LocalPlayer.h',
    'include/GameSession.h',
    'include/ServerNetworkManager.h',
    'src/AuthManager.cpp',
    'src/Board.cpp',
    'src/Player.cpp',
    'src/AIPlayer.cpp',
    'src/WebSocketPlayer.cpp',
    'src/LocalPlayer.cpp',
    'src/GameSession.cpp',
    'src/ServerNetworkManager.cpp',
    'src/main.cpp',
    'Makefile',
    'CMakeLists.txt',
    'build_linux.sh',
    'users.txt'
  ];

  const files = filePaths.map(relPath => {
    const fullPath = path.join(__dirname, relPath);
    let content = '';
    let exists = false;
    if (fs.existsSync(fullPath)) {
      content = fs.readFileSync(fullPath, 'utf8');
      exists = true;
    }
    return { path: relPath, content, exists };
  });

  res.json({ files });
});

// ============================================================================
// GAME LOGIC (Mirrors Board.cpp & GameSession.cpp)
// ============================================================================
class WebGameSession {
  sessionId: string;
  grid: string[][]; // 3x3 array initialized to ' '
  playerX: string;
  playerO: string | null;
  currentTurn: 'X' | 'O';
  state: 'WAITING' | 'ACTIVE' | 'FINISHED' | 'ABANDONED';
  winner: string;
  moveCount: number;
  isBot: boolean;

  constructor(sessionId: string, hostUser: string, isBot = false) {
    this.sessionId = sessionId;
    this.grid = [
      [' ', ' ', ' '],
      [' ', ' ', ' '],
      [' ', ' ', ' '],
    ];
    this.playerX = hostUser;
    this.isBot = isBot;
    this.playerO = isBot ? 'Minimax AI (Bot)' : null;
    this.currentTurn = 'X';
    this.state = isBot ? 'ACTIVE' : 'WAITING';
    this.winner = '';
    this.moveCount = 0;
  }

  joinGuest(guestUser: string): boolean {
    if (this.state !== 'WAITING' || this.playerO !== null) return false;
    this.playerO = guestUser;
    this.state = 'ACTIVE';
    this.currentTurn = 'X';
    return true;
  }

  makeMove(username: string, row: number, col: number): { success: boolean; message?: string } {
    if (this.state !== 'ACTIVE') {
      return { success: false, message: 'Game is not in active state.' };
    }

    const symbol: 'X' | 'O' = username === this.playerX ? 'X' : (username === this.playerO ? 'O' : null as any);
    if (!symbol) {
      return { success: false, message: 'You are not a player in this room.' };
    }

    if (symbol !== this.currentTurn) {
      return { success: false, message: 'Not your turn.' };
    }

    if (row < 0 || row > 2 || col < 0 || col > 2) {
      return { success: false, message: 'Move out of bounds.' };
    }

    if (this.grid[row][col] !== ' ') {
      return { success: false, message: 'Cell already occupied.' };
    }

    this.grid[row][col] = symbol;
    this.moveCount++;

    // Evaluate Win
    if (this.checkWin(symbol)) {
      this.state = 'FINISHED';
      this.winner = username;
    } else if (this.moveCount >= 9) {
      this.state = 'FINISHED';
      this.winner = 'DRAW';
    } else {
      this.currentTurn = this.currentTurn === 'X' ? 'O' : 'X';
    }

    return { success: true };
  }

  private checkWin(sym: string): boolean {
    const g = this.grid;
    // Rows
    for (let r = 0; r < 3; r++) {
      if (g[r][0] === sym && g[r][1] === sym && g[r][2] === sym) return true;
    }
    // Cols
    for (let c = 0; c < 3; c++) {
      if (g[0][c] === sym && g[1][c] === sym && g[2][c] === sym) return true;
    }
    // Diagonals
    if (g[0][0] === sym && g[1][1] === sym && g[2][2] === sym) return true;
    if (g[0][2] === sym && g[1][1] === sym && g[2][0] === sym) return true;
    return false;
  }

  // =========================================================================
  // MINIMAX ALGORITHM IMPLEMENTATION (Recursive Game Tree Search)
  // Base Cases: AI Win (+10 - depth), Opponent Win (depth - 10), Draw (0)
  // =========================================================================
  private minimax(grid: string[][], depth: number, isMaximizing: boolean): number {
    if (this.checkWinFor(grid, 'O')) return 10 - depth;
    if (this.checkWinFor(grid, 'X')) return depth - 10;
    if (this.isBoardFull(grid)) return 0;

    if (isMaximizing) {
      let maxEval = -Infinity;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          if (grid[r][c] === ' ') {
            grid[r][c] = 'O';
            const evaluation = this.minimax(grid, depth + 1, false);
            grid[r][c] = ' ';
            maxEval = Math.max(maxEval, evaluation);
          }
        }
      }
      return maxEval;
    } else {
      let minEval = Infinity;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          if (grid[r][c] === ' ') {
            grid[r][c] = 'X';
            const evaluation = this.minimax(grid, depth + 1, true);
            grid[r][c] = ' ';
            minEval = Math.min(minEval, evaluation);
          }
        }
      }
      return minEval;
    }
  }

  private isBoardFull(grid: string[][]): boolean {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (grid[r][c] === ' ') return false;
      }
    }
    return true;
  }

  private checkWinFor(grid: string[][], sym: string): boolean {
    for (let r = 0; r < 3; r++) {
      if (grid[r][0] === sym && grid[r][1] === sym && grid[r][2] === sym) return true;
    }
    for (let c = 0; c < 3; c++) {
      if (grid[0][c] === sym && grid[1][c] === sym && grid[2][c] === sym) return true;
    }
    if (grid[0][0] === sym && grid[1][1] === sym && grid[2][2] === sym) return true;
    if (grid[0][2] === sym && grid[1][1] === sym && grid[2][0] === sym) return true;
    return false;
  }

  getBestBotMove(): [number, number] {
    let bestScore = -Infinity;
    let bestMove: [number, number] = [-1, -1];

    // Strategic optimization: if center is available on first turn, claim it
    if (this.grid[1][1] === ' ') {
      let emptyCount = 0;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          if (this.grid[r][c] === ' ') emptyCount++;
        }
      }
      if (emptyCount >= 8) return [1, 1];
    }

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (this.grid[r][c] === ' ') {
          this.grid[r][c] = 'O';
          const score = this.minimax(this.grid, 0, false);
          this.grid[r][c] = ' ';
          if (score > bestScore) {
            bestScore = score;
            bestMove = [r, c];
          }
        }
      }
    }
    return bestMove;
  }

  restart() {
    this.grid = [
      [' ', ' ', ' '],
      [' ', ' ', ' '],
      [' ', ' ', ' '],
    ];
    this.currentTurn = 'X';
    this.state = 'ACTIVE';
    this.winner = '';
    this.moveCount = 0;
  }

  serialize(): string {
    return this.grid.flat().join('');
  }

  toJson() {
    return {
      type: 'game_state',
      sessionId: this.sessionId,
      state: this.state,
      playerX: this.playerX,
      playerO: this.playerO || '',
      currentTurn: this.currentTurn,
      winner: this.winner,
      board: this.serialize(),
      isBot: this.isBot,
    };
  }
}

// Active Sessions Store
const activeRooms = new Map<string, WebGameSession>();
const userSockets = new Map<string, WebSocket>();
const socketToUser = new Map<WebSocket, string>();
const userToRoom = new Map<string, string>();

// ============================================================================
// HTTP & WEBSOCKET SERVER ATTACHMENT
// ============================================================================
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcastRoom(sessionId: string) {
  const room = activeRooms.get(sessionId);
  if (!room) return;
  const payload = JSON.stringify(room.toJson());

  if (room.playerX && userSockets.has(room.playerX)) {
    const ws = userSockets.get(room.playerX)!;
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
  if (room.playerO && userSockets.has(room.playerO)) {
    const ws = userSockets.get(room.playerO)!;
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

function broadcastLobbyRooms() {
  const roomsList = Array.from(activeRooms.values())
    .filter(r => r.state === 'WAITING' || r.state === 'ACTIVE')
    .map(r => ({
      sessionId: r.sessionId,
      state: r.state,
      playerX: r.playerX,
      playerO: r.playerO || '',
    }));

  const payload = JSON.stringify({ type: 'lobby_list', rooms: roomsList });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

wss.on('connection', (ws) => {
  console.log('[WebSocket] Client connected');

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      const { type, username } = data;

      if (type === 'auth') {
        if (!username) return;
        userSockets.set(username, ws);
        socketToUser.set(ws, username);
        ws.send(JSON.stringify({ type: 'auth_success', username }));
        broadcastLobbyRooms();
      } else if (type === 'create_room') {
        const u = username || socketToUser.get(ws);
        if (!u) return;

        // Auto room code
        const roomId = 'ROOM-' + Math.floor(1000 + Math.random() * 9000);
        const session = new WebGameSession(roomId, u, false);
        activeRooms.set(roomId, session);
        userToRoom.set(u, roomId);

        console.log(`[Lobby] Room ${roomId} created by ${u}`);
        ws.send(JSON.stringify(session.toJson()));
        broadcastLobbyRooms();
      } else if (type === 'create_bot_room') {
        const u = username || socketToUser.get(ws);
        if (!u) return;

        // Auto room code for Single Player Bot match
        const roomId = 'BOT-' + Math.floor(1000 + Math.random() * 9000);
        const session = new WebGameSession(roomId, u, true);
        activeRooms.set(roomId, session);
        userToRoom.set(u, roomId);

        console.log(`[Lobby] Single-Player Bot Room ${roomId} created by ${u}`);
        ws.send(JSON.stringify(session.toJson()));
        broadcastLobbyRooms();
      } else if (type === 'join_room') {
        const u = username || socketToUser.get(ws);
        const { roomId } = data;
        if (!u || !roomId) return;

        const session = activeRooms.get(roomId);
        if (!session) {
          return ws.send(JSON.stringify({ type: 'error', message: 'Room not found.' }));
        }

        if (!session.joinGuest(u)) {
          return ws.send(JSON.stringify({ type: 'error', message: 'Room is already full.' }));
        }

        userToRoom.set(u, roomId);
        console.log(`[Lobby] ${u} joined room ${roomId}`);
        broadcastRoom(roomId);
        broadcastLobbyRooms();
      } else if (type === 'move') {
        const u = username || socketToUser.get(ws);
        const { row, col } = data;
        if (!u) return;

        const roomId = userToRoom.get(u);
        if (!roomId) {
          return ws.send(JSON.stringify({ type: 'error', message: 'Not currently in a room.' }));
        }

        const session = activeRooms.get(roomId);
        if (!session) return;

        const result = session.makeMove(u, row, col);
        if (!result.success) {
          return ws.send(JSON.stringify({ type: 'move_rejected', message: result.message }));
        }

        broadcastRoom(roomId);
        if (session.state === 'FINISHED') {
          broadcastLobbyRooms();
        } else if (session.isBot && session.state === 'ACTIVE' && session.currentTurn === 'O') {
          // Asynchronous Bot turn execution using Minimax
          setTimeout(() => {
            const [botR, botC] = session.getBestBotMove();
            if (botR !== -1 && botC !== -1) {
              session.makeMove('Minimax AI (Bot)', botR, botC);
              broadcastRoom(roomId);
              if (session.state === 'FINISHED') {
                broadcastLobbyRooms();
              }
            }
          }, 350);
        }
      } else if (type === 'rematch') {
        const u = username || socketToUser.get(ws);
        if (!u) return;
        const roomId = userToRoom.get(u);
        if (!roomId) return;
        const session = activeRooms.get(roomId);
        if (session) {
          session.restart();
          broadcastRoom(roomId);
          broadcastLobbyRooms();
        }
      } else if (type === 'leave_room') {
        const u = username || socketToUser.get(ws);
        if (!u) return;
        const roomId = userToRoom.get(u);
        if (roomId) {
          const session = activeRooms.get(roomId);
          if (session) {
            session.state = 'ABANDONED';
            session.winner = u === session.playerX ? (session.playerO ? `${session.playerO} (by forfeit)` : 'ABANDONED') : `${session.playerX} (by forfeit)`;
            broadcastRoom(roomId);
          }
          userToRoom.delete(u);
          broadcastLobbyRooms();
        }
      } else if (type === 'get_lobby') {
        broadcastLobbyRooms();
      }
    } catch (err) {
      console.error('[WebSocket ERROR] Invalid message payload:', err);
    }
  });

  ws.on('close', () => {
    const user = socketToUser.get(ws);
    if (user) {
      console.log(`[WebSocket] ${user} disconnected`);
      userSockets.delete(user);
      socketToUser.delete(ws);

      const roomId = userToRoom.get(user);
      if (roomId) {
        const session = activeRooms.get(roomId);
        if (session && session.state === 'ACTIVE') {
          session.state = 'ABANDONED';
          session.winner = user === session.playerX ? `${session.playerO} (by forfeit)` : `${session.playerX} (by forfeit)`;
          broadcastRoom(roomId);
        }
        userToRoom.delete(user);
        broadcastLobbyRooms();
      }
    }
  });
});

// ============================================================================
// VITE MIDDLEWARE / STATIC ASSETS MOUNT
// ============================================================================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, () => {
    console.log(`[SERVER BOOT] Tic-Tac-Toe Full-Stack Server running on port ${PORT}`);
    console.log(`[WEBSOCKET] WebSocket endpoint listening at ws://localhost:${PORT}/ws`);
  });
}

startServer();
