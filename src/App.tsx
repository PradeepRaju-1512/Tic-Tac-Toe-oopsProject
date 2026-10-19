/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Shield,
  Cpu,
  Layers,
  Terminal,
  Users,
  LogOut,
  RefreshCw,
  Copy,
  Check,
  FileCode,
  Lock,
  AlertCircle,
  Swords,
  Award,
  ChevronRight,
  Database
} from 'lucide-react';

// Web Audio sound generator for snappiness (no external assets)
function playTone(type: 'move' | 'win' | 'draw' | 'error') {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (type === 'move') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (type === 'win') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
      osc.frequency.setValueAtTime(783.99, now + 0.2); // G5
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === 'draw') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.linearRampToValueAtTime(200, now + 0.2);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    } else if (type === 'error') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(150, now);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.15);
    }
  } catch {
    // AudioContext blocked or not supported
  }
}

interface GameState {
  sessionId: string;
  state: 'WAITING' | 'ACTIVE' | 'FINISHED' | 'ABANDONED';
  playerX: string;
  playerO: string;
  currentTurn: 'X' | 'O';
  winner: string;
  board: string;
}

interface LobbyRoom {
  sessionId: string;
  state: string;
  playerX: string;
  playerO: string;
}

interface CppFile {
  path: string;
  content: string;
  exists: boolean;
}

export default function App() {
  // Navigation / Views
  const [activeTab, setActiveTab] = useState<'game' | 'code' | 'database'>('game');

  // Authentication State
  const [user, setUser] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // WebSocket & Game State
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lobbyRooms, setLobbyRooms] = useState<LobbyRoom[]>([]);
  const [currentGame, setCurrentGame] = useState<GameState | null>(null);
  const [inputRoomCode, setInputRoomCode] = useState('');
  const [gameMessage, setGameMessage] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Academic Inspector & Code Viewer State
  const [cppFiles, setCppFiles] = useState<CppFile[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string>('include/AuthManager.h');
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [dbUsers, setDbUsers] = useState<any[]>([]);

  // Reconnect / establish WebSocket
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      setConnected(true);
      if (user) {
        socket.send(JSON.stringify({ type: 'auth', username: user }));
      }
      socket.send(JSON.stringify({ type: 'get_lobby' }));
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'auth_success') {
          setConnected(true);
        } else if (msg.type === 'lobby_list') {
          setLobbyRooms(msg.rooms || []);
        } else if (msg.type === 'game_state') {
          setCurrentGame(msg);
          setGameMessage(null);
          if (msg.state === 'FINISHED') {
            if (msg.winner === 'DRAW') playTone('draw');
            else playTone('win');
          }
        } else if (msg.type === 'move_rejected') {
          setGameMessage(msg.message);
          playTone('error');
        } else if (msg.type === 'error') {
          setGameMessage(msg.message);
          playTone('error');
        }
      } catch (err) {
        console.error('WS Parse Error:', err);
      }
    };

    socket.onclose = () => {
      setConnected(false);
    };

    setWs(socket);

    return () => {
      socket.close();
    };
  }, [user]);

  // Fetch C++ files for Inspector
  useEffect(() => {
    async function loadCppFiles() {
      setLoadingFiles(true);
      try {
        const res = await fetch('/api/cpp/files');
        const data = await res.json();
        if (data.files) {
          setCppFiles(data.files);
        }
      } catch (err) {
        console.error('Failed to load C++ files:', err);
      } finally {
        setLoadingFiles(false);
      }
    }
    loadCppFiles();
  }, []);

  // Fetch users from users.txt
  const loadDatabaseUsers = async () => {
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      if (data.users) {
        setDbUsers(data.users);
      }
    } catch (err) {
      console.error('Failed to load database users:', err);
    }
  };

  useEffect(() => {
    if (activeTab === 'database') {
      loadDatabaseUsers();
    }
  }, [activeTab]);

  // Auth Handler
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);
    setAuthLoading(true);

    const endpoint = authMode === 'login' ? '/api/login' : '/api/register';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authUsername.trim(), password: authPassword }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (authMode === 'login') {
          setUser(data.username);
          setAuthPassword('');
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'auth', username: data.username }));
          }
        } else {
          setAuthSuccess('Account registered in users.txt! Please log in.');
          setAuthMode('login');
        }
      } else {
        setAuthError(data.message || 'Authentication failed.');
      }
    } catch {
      setAuthError('Connection error to C++ auth server.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    if (currentGame && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'leave_room', username: user }));
    }
    setUser(null);
    setCurrentGame(null);
    setAuthUsername('');
    setAuthPassword('');
  };

  const handleCreateRoom = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !user) return;
    setGameMessage(null);
    ws.send(JSON.stringify({ type: 'create_room', username: user }));
  };

  const handleCreateBotRoom = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !user) return;
    setGameMessage(null);
    ws.send(JSON.stringify({ type: 'create_bot_room', username: user }));
  };

  const handleJoinRoom = (roomId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !user || !roomId) return;
    setGameMessage(null);
    ws.send(JSON.stringify({ type: 'join_room', username: user, roomId: roomId.trim() }));
    setInputRoomCode('');
  };

  const handleCellClick = (r: number, c: number) => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !user || !currentGame) return;
    if (currentGame.state !== 'ACTIVE') return;

    // Check if cell is empty
    const cellIdx = r * 3 + c;
    if (currentGame.board[cellIdx] !== ' ') {
      playTone('error');
      return;
    }

    // Check turn
    const isPlayerX = user === currentGame.playerX;
    const isMyTurn = (isPlayerX && currentGame.currentTurn === 'X') || (!isPlayerX && currentGame.currentTurn === 'O');
    if (!isMyTurn) {
      setGameMessage("Wait for your opponent's turn!");
      playTone('error');
      return;
    }

    playTone('move');
    ws.send(JSON.stringify({ type: 'move', username: user, row: r, col: c }));
  };

  const handleRematch = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !user) return;
    ws.send(JSON.stringify({ type: 'rematch', username: user }));
  };

  const handleLeaveRoom = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !user) return;
    ws.send(JSON.stringify({ type: 'leave_room', username: user }));
    setCurrentGame(null);
    setGameMessage(null);
  };

  const copyRoomCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const selectedFile = cppFiles.find(f => f.path === selectedFilePath);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-black">
      {/* ================================================================== */}
      {/* TOP BAR CONTRACT: Single text brand, nav links, primary action     */}
      {/* ================================================================== */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between gap-8">
          {/* Zone 1: Brand Wordmark in display face */}
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-base font-semibold tracking-tight text-white whitespace-nowrap">
              C++ Systems Multiplayer
            </span>
            <span className="text-xs text-slate-400 font-mono hidden sm:inline">
              CS204 B.Tech Project
            </span>
          </div>

          {/* Zone 2: Navigation Tabs */}
          <nav className="flex items-center gap-6 text-sm font-medium text-slate-400">
            <button
              onClick={() => setActiveTab('game')}
              className={`hover:text-white transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                activeTab === 'game' ? 'text-cyan-400 border-b-2 border-cyan-400 py-1 font-semibold' : ''
              }`}
            >
              <Swords className="w-4 h-4" />
              <span>Game Arena</span>
            </button>
            <button
              onClick={() => setActiveTab('code')}
              className={`hover:text-white transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                activeTab === 'code' ? 'text-cyan-400 border-b-2 border-cyan-400 py-1 font-semibold' : ''
              }`}
            >
              <FileCode className="w-4 h-4" />
              <span>OOP & C++ Inspector</span>
            </button>
            <button
              onClick={() => setActiveTab('database')}
              className={`hover:text-white transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                activeTab === 'database' ? 'text-cyan-400 border-b-2 border-cyan-400 py-1 font-semibold' : ''
              }`}
            >
              <Database className="w-4 h-4" />
              <span>users.txt Store</span>
            </button>
          </nav>

          {/* Zone 3: Primary Action / User Profile */}
          <div className="flex items-center gap-3 shrink-0">
            {user ? (
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-300 font-mono bg-slate-800/80 px-2.5 py-1 rounded border border-slate-700">
                  {user}
                </span>
                <button
                  onClick={handleLogout}
                  className="text-xs text-slate-400 hover:text-rose-400 transition-colors flex items-center gap-1 whitespace-nowrap"
                  title="Logout"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Logout</span>
                </button>
              </div>
            ) : (
              <span className="text-xs text-slate-500 font-mono">Unauthenticated</span>
            )}
          </div>
        </div>
      </header>

      {/* ================================================================== */}
      {/* MAIN VIEWPORT                                                      */}
      {/* ================================================================== */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 flex flex-col">
        {/* VIEW 1: GAME ARENA */}
        {activeTab === 'game' && (
          <div className="flex-1 flex flex-col">
            {!user ? (
              /* AUTHENTICATION VIEW */
              <div className="max-w-md w-full mx-auto my-auto py-12">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 shadow-2xl">
                  <div className="mb-6 text-center">
                    <div className="w-12 h-12 bg-cyan-950 border border-cyan-800/60 rounded-xl flex items-center justify-center mx-auto mb-3">
                      <Lock className="w-6 h-6 text-cyan-400" />
                    </div>
                    <h1 className="text-xl font-bold text-white tracking-tight">
                      C++ Multi-Player Login
                    </h1>
                    <p className="text-xs text-slate-400 mt-1">
                      File-based authentication with Salted DJB2 hashing
                    </p>
                  </div>

                  {/* Auth Mode Toggle */}
                  <div className="flex bg-slate-950 p-1 rounded-lg mb-6 border border-slate-800">
                    <button
                      type="button"
                      onClick={() => { setAuthMode('login'); setAuthError(null); setAuthSuccess(null); }}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                        authMode === 'login' ? 'bg-cyan-500 text-slate-950 shadow' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Login
                    </button>
                    <button
                      type="button"
                      onClick={() => { setAuthMode('register'); setAuthError(null); setAuthSuccess(null); }}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                        authMode === 'register' ? 'bg-cyan-500 text-slate-950 shadow' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Register
                    </button>
                  </div>

                  {/* Error & Success Feedback */}
                  {authError && (
                    <div className="mb-4 p-3 bg-rose-950/60 border border-rose-800 text-rose-300 text-xs rounded-lg flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{authError}</span>
                    </div>
                  )}
                  {authSuccess && (
                    <div className="mb-4 p-3 bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs rounded-lg flex items-center gap-2">
                      <Check className="w-4 h-4 shrink-0" />
                      <span>{authSuccess}</span>
                    </div>
                  )}

                  <form onSubmit={handleAuth} className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Username
                      </label>
                      <input
                        type="text"
                        value={authUsername}
                        onChange={(e) => setAuthUsername(e.target.value)}
                        placeholder="e.g. student"
                        required
                        className="w-full px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Password
                      </label>
                      <input
                        type="password"
                        value={authPassword}
                        onChange={(e) => setAuthPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        className="w-full px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition-colors"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={authLoading}
                      className="w-full mt-2 py-2.5 px-4 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-semibold text-sm rounded-lg transition-colors flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/10"
                    >
                      {authLoading ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        authMode === 'login' ? 'Authenticate' : 'Create Account'
                      )}
                    </button>
                  </form>

                  {/* Quick Academic Demo Accounts */}
                  <div className="mt-6 pt-5 border-t border-slate-800 text-center">
                    <p className="text-xs text-slate-400 mb-2">Pre-registered academic demo accounts:</p>
                    <div className="flex justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => { setAuthUsername('student'); setAuthPassword('pass123'); }}
                        className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition-colors font-mono"
                      >
                        student / pass123
                      </button>
                      <button
                        type="button"
                        onClick={() => { setAuthUsername('professor'); setAuthPassword('pass123'); }}
                        className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition-colors font-mono"
                      >
                        professor / pass123
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : !currentGame ? (
              /* LOBBY & ROOM SELECTION */
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 my-auto py-6">
                {/* Left Card: Create or Join Room */}
                <div className="lg:col-span-1 space-y-6">
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <h2 className="text-base font-semibold text-white mb-1 flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-emerald-400" />
                      Single Player (Minimax AI)
                    </h2>
                    <p className="text-xs text-slate-400 mb-4">
                      Challenge the server-side bot powered by the recursive Minimax decision tree algorithm.
                    </p>
                    <button
                      onClick={handleCreateBotRoom}
                      className="w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm rounded-lg transition-colors flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/10"
                    >
                      <Cpu className="w-4 h-4" />
                      Play vs Bot
                    </button>
                  </div>

                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <h2 className="text-base font-semibold text-white mb-1 flex items-center gap-2">
                      <Swords className="w-4 h-4 text-cyan-400" />
                      Host Multiplayer Match
                    </h2>
                    <p className="text-xs text-slate-400 mb-4">
                      Create an authoritative room for a human opponent. You will play as Player X.
                    </p>
                    <button
                      onClick={handleCreateRoom}
                      className="w-full py-2.5 px-4 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      Create Game Room
                    </button>
                  </div>

                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <h2 className="text-base font-semibold text-white mb-1 flex items-center gap-2">
                      <Users className="w-4 h-4 text-cyan-400" />
                      Join by Code
                    </h2>
                    <p className="text-xs text-slate-400 mb-4">
                      Enter the room ID provided by the host. You will play as Player O.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={inputRoomCode}
                        onChange={(e) => setInputRoomCode(e.target.value.toUpperCase())}
                        placeholder="ROOM-1234"
                        className="flex-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white font-mono placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                      />
                      <button
                        onClick={() => handleJoinRoom(inputRoomCode)}
                        disabled={!inputRoomCode.trim()}
                        className="py-2 px-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white font-medium text-sm rounded-lg transition-colors"
                      >
                        Join
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right Card: Active Room Directory */}
                <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col">
                  <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                    <div>
                      <h2 className="text-base font-semibold text-white">Live Multiplayer Lobby</h2>
                      <p className="text-xs text-slate-400">Rooms managed by Crow C++ WebSockets</p>
                    </div>
                    <span className="text-xs font-mono text-cyan-400 bg-cyan-950/60 border border-cyan-800/80 px-2 py-0.5 rounded">
                      {lobbyRooms.length} Active
                    </span>
                  </div>

                  {gameMessage && (
                    <div className="mt-4 p-3 bg-rose-950/60 border border-rose-800 text-rose-300 text-xs rounded-lg flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{gameMessage}</span>
                    </div>
                  )}

                  <div className="flex-1 mt-4 overflow-y-auto space-y-2.5">
                    {lobbyRooms.length === 0 ? (
                      <div className="h-48 flex flex-col items-center justify-center text-slate-500 text-xs">
                        <Users className="w-8 h-8 mb-2 opacity-40" />
                        <span>No open rooms currently. Click &quot;Create Game Room&quot; to host!</span>
                      </div>
                    ) : (
                      lobbyRooms.map((room) => (
                        <div
                          key={room.sessionId}
                          className="flex items-center justify-between p-3.5 bg-slate-950/70 border border-slate-800/80 rounded-lg hover:border-slate-700 transition-colors"
                        >
                          <div className="flex items-center gap-4">
                            <span className="text-xs font-mono font-bold text-white bg-slate-800 px-2.5 py-1 rounded">
                              {room.sessionId}
                            </span>
                            <div className="text-xs">
                              <span className="text-slate-400">Host:</span>{' '}
                              <span className="text-cyan-400 font-medium">{room.playerX}</span>
                              {room.playerO && (
                                <>
                                  <span className="text-slate-500 mx-1.5">vs</span>
                                  <span className="text-rose-400 font-medium">{room.playerO}</span>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <span className="text-xs text-slate-400">
                              {room.state === 'WAITING' ? (
                                <span className="text-amber-400">Waiting for opponent</span>
                              ) : (
                                <span className="text-emerald-400">In Progress</span>
                              )}
                            </span>
                            {room.state === 'WAITING' && room.playerX !== user && (
                              <button
                                onClick={() => handleJoinRoom(room.sessionId)}
                                className="px-3 py-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-medium text-xs rounded transition-colors"
                              >
                                Join
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : (
              /* ACTIVE GAME SESSION VIEW */
              <div className="max-w-2xl w-full mx-auto my-auto py-6">
                {/* HUD Header */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-slate-300 bg-slate-800 px-2.5 py-1 rounded">
                        {currentGame.sessionId}
                      </span>
                      <button
                        onClick={() => copyRoomCode(currentGame.sessionId)}
                        className="text-slate-400 hover:text-white transition-colors"
                        title="Copy Room Code"
                      >
                        {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>

                    <button
                      onClick={handleLeaveRoom}
                      className="text-xs text-slate-400 hover:text-rose-400 transition-colors"
                    >
                      Leave Room
                    </button>
                  </div>

                  {/* Player Matchup Banner */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* Player X */}
                    <div className={`p-3 rounded-lg border transition-all ${
                      currentGame.currentTurn === 'X' && currentGame.state === 'ACTIVE'
                        ? 'bg-cyan-950/40 border-cyan-500/60 shadow-lg shadow-cyan-500/10'
                        : 'bg-slate-950 border-slate-800'
                    }`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded bg-cyan-500/20 text-cyan-400 font-bold font-mono text-sm flex items-center justify-center">
                            X
                          </span>
                          <span className="text-sm font-semibold text-white">
                            {currentGame.playerX}
                          </span>
                        </div>
                        {user === currentGame.playerX && (
                          <span className="text-[10px] uppercase font-mono text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                            You
                          </span>
                        )}
                      </div>
                      {currentGame.state === 'ACTIVE' && currentGame.currentTurn === 'X' && (
                        <div className="text-[11px] text-cyan-400 mt-1 font-medium">Turn Active</div>
                      )}
                    </div>

                    {/* Player O */}
                    <div className={`p-3 rounded-lg border transition-all ${
                      currentGame.currentTurn === 'O' && currentGame.state === 'ACTIVE'
                        ? 'bg-rose-950/40 border-rose-500/60 shadow-lg shadow-rose-500/10'
                        : 'bg-slate-950 border-slate-800'
                    }`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded bg-rose-500/20 text-rose-400 font-bold font-mono text-sm flex items-center justify-center">
                            O
                          </span>
                          <span className="text-sm font-semibold text-white">
                            {currentGame.playerO || 'Waiting for opponent...'}
                          </span>
                        </div>
                        {user === currentGame.playerO && (
                          <span className="text-[10px] uppercase font-mono text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                            You
                          </span>
                        )}
                      </div>
                      {currentGame.state === 'ACTIVE' && currentGame.currentTurn === 'O' && (
                        <div className="text-[11px] text-rose-400 mt-1 font-medium">Turn Active</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Status / Announcement Box */}
                {gameMessage && (
                  <div className="mb-4 p-3 bg-rose-950/60 border border-rose-800 text-rose-300 text-xs rounded-lg flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{gameMessage}</span>
                  </div>
                )}

                {currentGame.state === 'WAITING' && (
                  <div className="mb-4 p-4 bg-amber-950/30 border border-amber-800/80 rounded-xl text-center">
                    <p className="text-sm font-medium text-amber-300">
                      Waiting for Opponent to Join
                    </p>
                    <p className="text-xs text-amber-400/80 mt-1">
                      Share room code <span className="font-mono font-bold text-white bg-slate-900 px-2 py-0.5 rounded">{currentGame.sessionId}</span> or have a second player click &quot;Join&quot; in the lobby.
                    </p>
                  </div>
                )}

                {currentGame.state === 'FINISHED' && (
                  <div className="mb-4 p-4 bg-slate-900 border border-slate-700 rounded-xl text-center">
                    <Award className="w-8 h-8 text-amber-400 mx-auto mb-1.5" />
                    <h3 className="text-base font-bold text-white">
                      {currentGame.winner === 'DRAW'
                        ? 'Match Drawn (Stalemate)'
                        : `${currentGame.winner} Wins!`}
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5 mb-3">
                      Validated by authoritative C++ Board logic
                    </p>
                    <button
                      onClick={handleRematch}
                      className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors inline-flex items-center gap-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Play Rematch
                    </button>
                  </div>
                )}

                {currentGame.state === 'ABANDONED' && (
                  <div className="mb-4 p-4 bg-slate-900 border border-rose-800 rounded-xl text-center">
                    <p className="text-sm font-bold text-rose-300">Match Abandoned</p>
                    <p className="text-xs text-slate-400 mt-1 mb-3">
                      Winner: {currentGame.winner}
                    </p>
                    <button
                      onClick={handleLeaveRoom}
                      className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs rounded"
                    >
                      Return to Lobby
                    </button>
                  </div>
                )}

                {/* 3x3 Game Grid (Strict Encapsulation) */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col items-center">
                  <div className="grid grid-cols-3 gap-3 w-72 h-72 sm:w-84 sm:h-84">
                    {[0, 1, 2].map((r) =>
                      [0, 1, 2].map((c) => {
                        const idx = r * 3 + c;
                        const marker = currentGame.board[idx] || ' ';
                        const isPlayerX = user === currentGame.playerX;
                        const isMyTurn =
                          currentGame.state === 'ACTIVE' &&
                          ((isPlayerX && currentGame.currentTurn === 'X') ||
                            (!isPlayerX && currentGame.currentTurn === 'O'));

                        return (
                          <button
                            key={`${r}-${c}`}
                            type="button"
                            onClick={() => handleCellClick(r, c)}
                            disabled={marker !== ' ' || !isMyTurn}
                            className={`rounded-xl flex items-center justify-center font-mono font-bold text-4xl sm:text-5xl transition-all duration-150 ${
                              marker === ' '
                                ? isMyTurn
                                  ? 'bg-slate-950 border border-slate-700 hover:border-cyan-400 hover:bg-slate-800/80 cursor-pointer'
                                  : 'bg-slate-950/60 border border-slate-800/50 cursor-not-allowed'
                                : marker === 'X'
                                ? 'bg-cyan-950/60 border border-cyan-700/80 text-cyan-400 shadow-md'
                                : 'bg-rose-950/60 border border-rose-700/80 text-rose-400 shadow-md'
                            }`}
                          >
                            {marker !== ' ' ? marker : ''}
                          </button>
                        );
                      })
                    )}
                  </div>

                  <div className="mt-4 text-xs text-slate-500 font-mono">
                    Authoritative Board grid[3][3] · WebSocket Synchronized
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* VIEW 2: OOP & C++ CODE INSPECTOR */}
        {activeTab === 'code' && (
          <div className="flex-1 flex flex-col space-y-6">
            {/* Academic 4 Pillars + DSA Minimax Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center gap-2 text-cyan-400 mb-1.5 font-semibold text-sm">
                  <Shield className="w-4 h-4" />
                  <span>1. Encapsulation</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  <strong className="text-slate-200">Board.h:</strong> <code className="text-cyan-300">grid[3][3]</code> and <code className="text-cyan-300">moveCount</code> are strictly private. All mutations must pass <code className="text-cyan-300">makeMove()</code> which enforces row/col bounds, cell vacancy, and symbol validity.
                </p>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center gap-2 text-indigo-400 mb-1.5 font-semibold text-sm">
                  <Layers className="w-4 h-4" />
                  <span>2. Abstraction</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  <strong className="text-slate-200">ServerNetworkManager:</strong> Conceals Crow route registrations, Asio multithreading, and WebSocket protocol frames. Callers simply execute <code className="text-indigo-300">run()</code>.
                </p>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center gap-2 text-amber-400 mb-1.5 font-semibold text-sm">
                  <Cpu className="w-4 h-4" />
                  <span>3. Inheritance</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  <strong className="text-slate-200">Player Base:</strong> <code className="text-amber-300">WebSocketPlayer</code>, <code className="text-amber-300">LocalPlayer</code>, and <code className="text-amber-300">AIPlayer</code> inherit from abstract base <code className="text-amber-300">Player</code>, chaining constructor initialization.
                </p>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center gap-2 text-emerald-400 mb-1.5 font-semibold text-sm">
                  <Terminal className="w-4 h-4" />
                  <span>4. Polymorphism</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  <strong className="text-slate-200">Dynamic Dispatch:</strong> <code className="text-emerald-300">virtual getMove() = 0</code> allows GameSession to orchestrate games through base <code className="text-emerald-300">Player*</code> pointers with a virtual destructor.
                </p>
              </div>

              <div className="bg-slate-900 border border-emerald-800/60 rounded-xl p-4">
                <div className="flex items-center gap-2 text-emerald-400 mb-1.5 font-semibold text-sm">
                  <Cpu className="w-4 h-4" />
                  <span>5. DSA Minimax Bot</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  <strong className="text-slate-200">AIPlayer.cpp:</strong> Evaluates zero-sum game tree depth (O(9!) leaves). Base cases: AI Win (+10 - d), Loss (d - 10), Draw (0). Backtracks using <code className="text-emerald-300">undoMove()</code>.
                </p>
              </div>
            </div>

            {/* Systems Rigor Banner: The Hashing Trap */}
            <div className="bg-slate-900/90 border border-cyan-800/60 rounded-xl p-4 flex items-start gap-3">
              <div className="p-2 bg-cyan-950 text-cyan-400 rounded-lg shrink-0 mt-0.5">
                <Lock className="w-4 h-4" />
              </div>
              <div className="text-xs">
                <span className="font-semibold text-white">Systems Rigor Proof: The Hashing Trap Resolved</span>
                <p className="text-slate-400 mt-1 leading-relaxed">
                  Modern Linux C++ libraries randomize <code className="text-cyan-300 font-mono">std::hash</code> seeds per process invocation to mitigate HashDoS attacks. Saving <code className="text-cyan-300 font-mono">std::hash</code> to <code className="text-cyan-300 font-mono">users.txt</code> invalidates all stored user passwords on server restart. Our implementation uses deterministic 64-bit <strong>Salted DJB2</strong> (<code className="text-cyan-300 font-mono">hash = ((hash &lt;&lt; 5) + hash) + c</code>), guaranteeing password persistence across reboots.
                </p>
              </div>
            </div>

            {/* Code File Explorer & Viewer */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl flex-1 flex flex-col overflow-hidden min-h-[500px]">
              {/* File Selector Bar */}
              <div className="p-3 border-b border-slate-800 bg-slate-950 flex items-center gap-2 overflow-x-auto">
                <span className="text-xs text-slate-500 font-mono px-2 shrink-0">FILES:</span>
                {cppFiles.map((file) => (
                  <button
                    key={file.path}
                    onClick={() => setSelectedFilePath(file.path)}
                    className={`px-2.5 py-1 text-xs font-mono rounded transition-colors whitespace-nowrap shrink-0 ${
                      selectedFilePath === file.path
                        ? 'bg-cyan-500 text-slate-950 font-semibold'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    {file.path}
                  </button>
                ))}
              </div>

              {/* Code Content Area */}
              <div className="flex-1 p-4 bg-slate-950 overflow-auto font-mono text-xs text-slate-300">
                {loadingFiles ? (
                  <div className="h-full flex items-center justify-center text-slate-500">
                    <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                    <span>Loading C++ source files...</span>
                  </div>
                ) : selectedFile ? (
                  <div className="relative">
                    <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800 text-[11px] text-slate-400">
                      <span>File: {selectedFile.path}</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(selectedFile.content);
                          setCopiedCode(true);
                          setTimeout(() => setCopiedCode(false), 2000);
                        }}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded flex items-center gap-1 transition-colors"
                      >
                        {copiedCode ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>Copy File</span>
                      </button>
                    </div>
                    <pre className="overflow-x-auto leading-relaxed">
                      {selectedFile.content}
                    </pre>
                  </div>
                ) : (
                  <div className="text-slate-500">Select a file from the bar above.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* VIEW 3: USERS.TXT DATABASE INSPECTOR */}
        {activeTab === 'database' && (
          <div className="flex-1 flex flex-col space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <Database className="w-4 h-4 text-cyan-400" />
                    users.txt Storage Inspector
                  </h2>
                  <p className="text-xs text-slate-400">
                    Live inspection of persistent records saved by AuthManager
                  </p>
                </div>
                <button
                  onClick={loadDatabaseUsers}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 rounded flex items-center gap-1.5 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Refresh File</span>
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2.5 px-3">Username</th>
                      <th className="py-2.5 px-3">Cryptographic Salt</th>
                      <th className="py-2.5 px-3">Salted DJB2 Hash (64-bit uint)</th>
                      <th className="py-2.5 px-3">File Serialization Format</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {dbUsers.map((u, i) => (
                      <tr key={i} className="hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 text-cyan-400 font-semibold">{u.username}</td>
                        <td className="py-2.5 px-3 text-amber-400">{u.salt}</td>
                        <td className="py-2.5 px-3 text-slate-300 tabular-nums">{u.hash}</td>
                        <td className="py-2.5 px-3 text-slate-500 text-[11px]">
                          {u.username}:{u.salt}:{u.hash}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Linux Compilation Reference Guide */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-cyan-400" />
                Standalone Linux Terminal Compilation
              </h3>
              <p className="text-xs text-slate-400 mb-3">
                To compile and run this exact C++ codebase on any Ubuntu/Debian/Fedora Linux workstation:
              </p>
              <pre className="p-3 bg-slate-950 rounded-lg text-xs font-mono text-cyan-300 overflow-x-auto border border-slate-800 leading-relaxed">
{`# 1. Compile all translation units into a single binary:
g++ -std=c++17 -Wall -Wextra -O2 -pthread \\
    -Iinclude \\
    src/AuthManager.cpp \\
    src/Board.cpp \\
    src/Player.cpp \\
    src/WebSocketPlayer.cpp \\
    src/LocalPlayer.cpp \\
    src/GameSession.cpp \\
    src/ServerNetworkManager.cpp \\
    src/main.cpp \\
    -o tictactoe_server

# 2. Run the server (defaults to port 8080):
./tictactoe_server 8080`}
              </pre>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
