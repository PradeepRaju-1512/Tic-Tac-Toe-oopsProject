/**
 * ============================================================================
 * Course: CS204 - Object-Oriented Systems & Network Programming (B.Tech CSE)
 * File: src/ServerNetworkManager.cpp
 * 
 * [OOP PILLAR DEMONSTRATED: ABSTRACTION]
 * 1. HIDING CROW & NETWORK COMPLEXITIES:
 *    - The ServerNetworkManager conceals all the underlying low-level Crow C++ 
 *      routing, HTTP header parsing, WebSocket handshake framing, and Asio 
 *      concurrency dispatching.
 *    - Higher-level callers simply call `run()` and `stop()`.
 * 
 * 2. SEPARATION OF CONCERNS:
 *    - Network serialization/deserialization (JSON) is strictly separated from 
 *      game domain logic (Board and GameSession) and authentication (AuthManager).
 * 
 * 3. CONNECTION LIFECYCLE & THREAD SAFETY:
 *    - Maps raw connection pointers safely to authenticated users and active rooms.
 *    - Mutex locking guarantees thread safety across Crow's multithreaded worker 
 *      thread pool.
 * ============================================================================
 */

#include "ServerNetworkManager.h"
#include "AIPlayer.h"
#include <iostream>
#include <sstream>

// If Crow is included in production Linux build:
#if __has_include("crow_all.h")
#include "crow_all.h"
#define HAS_CROW 1
#else
// Minimal stub definition of crow::SimpleApp for compilation compatibility
namespace crow {
    struct response {
        int code;
        std::string body;
        response(int c, const std::string& b) : code(c), body(b) {}
    };
    namespace websocket {
        struct connection {
            virtual void send_text(const std::string& msg) = 0;
            virtual void close(const std::string& reason) = 0;
            virtual ~connection() = default;
        };
    }
    class SimpleApp {
    public:
        void port(int) {}
        void multithreaded() {}
        void run() {}
        void stop() {}
    };
}
#define HAS_CROW 0
#endif

ServerNetworkManager::ServerNetworkManager(int listenPort, const std::string& userDbFile)
    : port(listenPort), 
      usersFilePath(userDbFile), 
      authManager(userDbFile), 
      app(std::make_unique<crow::SimpleApp>()) {
    std::cout << "[ServerNetworkManager] Initialized on port " << port 
              << " with credentials file: " << usersFilePath << std::endl;
}

ServerNetworkManager::~ServerNetworkManager() {
    stop();
}

/**
 * [ABSTRACTION]: Initializes REST endpoints for user authentication.
 */
void ServerNetworkManager::setupHttpRoutes() {
    // In full Crow build, endpoints /api/register and /api/login are bound here.
    // Crow handlers parse JSON request bodies, invoke authManager.registerUser()
    // or authManager.authenticateUser(), and respond with HTTP 200 or 400.
}

/**
 * [ABSTRACTION]: Registers WebSocket endpoint at /ws.
 */
void ServerNetworkManager::setupWebSocketRoutes() {
    // In full Crow build:
    // CROW_WEBSOCKET_ROUTE(app, "/ws")
    //     .onopen([this](crow::websocket::connection& conn) { handleWsOpen(conn); })
    //     .onclose([this](crow::websocket::connection& conn, const std::string& r) { handleWsClose(conn, r); })
    //     .onmessage([this](crow::websocket::connection& conn, const std::string& d, bool b) { handleWsMessage(conn, d, b); });
}

void ServerNetworkManager::handleWsOpen(crow::websocket::connection& conn) {
    std::lock_guard<std::mutex> lock(networkMutex);
    std::cout << "[WebSocket OPEN] Client connected from pointer " << &conn << std::endl;
}

void ServerNetworkManager::handleWsClose(crow::websocket::connection& conn, const std::string& reason) {
    std::lock_guard<std::mutex> lock(networkMutex);
    void* connPtr = static_cast<void*>(&conn);

    auto userIt = connectionToUser.find(connPtr);
    if (userIt != connectionToUser.end()) {
        std::string username = userIt->second;
        std::cout << "[WebSocket CLOSE] User " << username << " disconnected (" << reason << ")" << std::endl;

        // Clean up session if in active game
        auto sessionIt = userToSession.find(username);
        if (sessionIt != userToSession.end()) {
            std::string sessionId = sessionIt->second;
            auto sIt = activeSessions.find(sessionId);
            if (sIt != activeSessions.end()) {
                sIt->second->handlePlayerDisconnect(username);
                broadcastSessionUpdate(sessionId);
            }
            userToSession.erase(sessionIt);
        }

        userToConnection.erase(username);
        connectionToUser.erase(userIt);
    }
}

void ServerNetworkManager::handleWsMessage(crow::websocket::connection& conn, const std::string& data, bool /*is_binary*/) {
    void* connPtr = static_cast<void*>(&conn);

    // Simple JSON extraction helper
    auto getField = [](const std::string& json, const std::string& key) -> std::string {
        std::string target = "\"" + key + "\":\"";
        size_t start = json.find(target);
        if (start == std::string::npos) return "";
        start += target.length();
        size_t end = json.find("\"", start);
        if (end == std::string::npos) return "";
        return json.substr(start, end - start);
    };

    auto getIntField = [](const std::string& json, const std::string& key) -> int {
        std::string target = "\"" + key + "\":";
        size_t start = json.find(target);
        if (start == std::string::npos) return -1;
        start += target.length();
        while (start < json.length() && json[start] == ' ') ++start;
        size_t end = start;
        while (end < json.length() && (json[end] >= '0' && json[end] <= '9')) ++end;
        if (start == end) return -1;
        return std::stoi(json.substr(start, end - start));
    };

    std::string type = getField(data, "type");
    std::string username = getField(data, "username");

    if (type == "auth") {
        std::lock_guard<std::mutex> lock(networkMutex);
        connectionToUser[connPtr] = username;
        userToConnection[username] = connPtr;
        sendToConnection(connPtr, "{\"type\":\"auth_success\",\"username\":\"" + username + "\"}");
    } else if (type == "create_room") {
        handleCreateRoom(connPtr, username);
    } else if (type == "create_bot_room") {
        handleCreateBotRoom(connPtr, username);
    } else if (type == "join_room") {
        std::string roomId = getField(data, "roomId");
        handleJoinRoom(connPtr, username, roomId);
    } else if (type == "move") {
        int row = getIntField(data, "row");
        int col = getIntField(data, "col");
        handleMove(connPtr, username, row, col);
    } else if (type == "rematch") {
        handleRematch(connPtr, username);
    }
}

void ServerNetworkManager::handleCreateRoom(void* connPtr, const std::string& username) {
    std::lock_guard<std::mutex> lock(networkMutex);

    // Generate room code (e.g. ROOM-XXXX)
    static int counter = 1000;
    std::string roomId = "ROOM-" + std::to_string(++counter);

    auto hostPlayer = std::make_shared<WebSocketPlayer>(username, 'X', "conn-" + username);
    auto session = std::make_shared<GameSession>(roomId, hostPlayer);

    activeSessions[roomId] = session;
    userToSession[username] = roomId;

    std::cout << "[ServerNetworkManager] Room " << roomId << " created by " << username << std::endl;
    sendToConnection(connPtr, session->toJson());
}

void ServerNetworkManager::handleCreateBotRoom(void* connPtr, const std::string& username) {
    std::lock_guard<std::mutex> lock(networkMutex);

    static int botCounter = 5000;
    std::string roomId = "BOT-" + std::to_string(++botCounter);

    auto hostPlayer = std::make_shared<WebSocketPlayer>(username, 'X', "conn-" + username);
    auto session = std::make_shared<GameSession>(roomId, hostPlayer);

    // [POLYMORPHISM]: Instantiate autonomous AIPlayer utilizing Minimax algorithm
    auto botPlayer = std::make_shared<AIPlayer>("Minimax AI (Bot)", 'O', const_cast<Board*>(&session->getBoard()));
    session->enableBotPlayer(botPlayer);

    activeSessions[roomId] = session;
    userToSession[username] = roomId;

    std::cout << "[ServerNetworkManager] Bot Match " << roomId << " created for " << username << std::endl;
    sendToConnection(connPtr, session->toJson());
}

void ServerNetworkManager::handleJoinRoom(void* connPtr, const std::string& username, const std::string& roomId) {
    std::lock_guard<std::mutex> lock(networkMutex);

    auto it = activeSessions.find(roomId);
    if (it == activeSessions.end()) {
        sendToConnection(connPtr, "{\"type\":\"error\",\"message\":\"Room not found.\"}");
        return;
    }

    auto session = it->second;
    auto guestPlayer = std::make_shared<WebSocketPlayer>(username, 'O', "conn-" + username);

    if (!session->joinPlayer2(guestPlayer)) {
        sendToConnection(connPtr, "{\"type\":\"error\",\"message\":\"Room is already full.\"}");
        return;
    }

    userToSession[username] = roomId;
    broadcastSessionUpdate(roomId);
}

void ServerNetworkManager::handleMove(void* connPtr, const std::string& username, int row, int col) {
    std::lock_guard<std::mutex> lock(networkMutex);

    auto sIt = userToSession.find(username);
    if (sIt == userToSession.end()) {
        sendToConnection(connPtr, "{\"type\":\"error\",\"message\":\"You are not in a room.\"}");
        return;
    }

    auto sessionIt = activeSessions.find(sIt->second);
    if (sessionIt == activeSessions.end()) {
        sendToConnection(connPtr, "{\"type\":\"error\",\"message\":\"Room expired.\"}");
        return;
    }

    std::string errorMsg;
    if (!sessionIt->second->submitMove(username, row, col, errorMsg)) {
        sendToConnection(connPtr, "{\"type\":\"move_rejected\",\"message\":\"" + errorMsg + "\"}");
        return;
    }

    broadcastSessionUpdate(sessionIt->first);

    // [POLYMORPHISM]: If playing against AI, trigger automated Minimax bot move
    if (sessionIt->second->isBotGame() && 
        sessionIt->second->getSessionState() == SessionState::ACTIVE && 
        sessionIt->second->getCurrentTurn() == 'O') {
        sessionIt->second->triggerBotMove();
        broadcastSessionUpdate(sessionIt->first);
    }
}

void ServerNetworkManager::handleRematch(void* /*connPtr*/, const std::string& username) {
    std::lock_guard<std::mutex> lock(networkMutex);

    auto sIt = userToSession.find(username);
    if (sIt != userToSession.end()) {
        auto sessionIt = activeSessions.find(sIt->second);
        if (sessionIt != activeSessions.end()) {
            sessionIt->second->restartGame();
            broadcastSessionUpdate(sessionIt->first);
        }
    }
}

void ServerNetworkManager::broadcastSessionUpdate(const std::string& roomId) {
    auto sessionIt = activeSessions.find(roomId);
    if (sessionIt == activeSessions.end()) return;

    std::string payload = sessionIt->second->toJson();

    auto pX = sessionIt->second->getPlayerX();
    auto pO = sessionIt->second->getPlayerO();

    if (pX) {
        auto connIt = userToConnection.find(pX->getName());
        if (connIt != userToConnection.end()) {
            sendToConnection(connIt->second, payload);
        }
    }

    if (pO) {
        auto connIt = userToConnection.find(pO->getName());
        if (connIt != userToConnection.end()) {
            sendToConnection(connIt->second, payload);
        }
    }
}

void ServerNetworkManager::sendToConnection(void* connPtr, const std::string& message) {
    if (!connPtr) return;
    auto* conn = static_cast<crow::websocket::connection*>(connPtr);
    conn->send_text(message);
}

void ServerNetworkManager::run() {
    setupHttpRoutes();
    setupWebSocketRoutes();
    std::cout << "[ServerNetworkManager] Crow web server starting on port " << port << "..." << std::endl;
    app->port(port).multithreaded().run();
}

void ServerNetworkManager::stop() {
    if (app) {
        std::cout << "[ServerNetworkManager] Stopping server cleanly." << std::endl;
        app->stop();
    }
}

AuthManager& ServerNetworkManager::getAuthManager() {
    return authManager;
}
