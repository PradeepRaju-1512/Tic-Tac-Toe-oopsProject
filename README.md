# C++ Online Multiplayer Tic-Tac-Toe

## 1. Introduction

This project is an implementation of Tic-Tac-Toe using C++ and Object-Oriented Programming (OOP) concepts. It aims to demonstrate the practical application of classes, objects, inheritance, polymorphism, encapsulation, and abstraction through a game-based application.

The project also explores multiplayer functionality through networking and provides a web-based user interface.

## 2. Objectives

- To understand and implement fundamental OOP concepts in C++.
- To design a modular and maintainable software application.
- To implement Tic-Tac-Toe game logic, including move validation and win detection.
- To explore networking and real-time communication.
- To develop a user interface for interacting with the game.

## 3. Technologies Used

- **C++** — Game logic and object-oriented design
- **HTML and CSS** — User interface and styling
- **React and TypeScript** — Frontend and server-side application components
- **WebSockets** — Real-time communication
- **CMake and Make** — Build configuration

## 4. OOP Concepts Used

- **Encapsulation:** Managing game state and data within classes.
- **Abstraction:** Defining common interfaces for player behaviour.
- **Inheritance:** Creating specialised player classes from a common base class.
- **Polymorphism:** Supporting different player implementations through a common interface.
- **Composition:** Combining game components to manage a complete session.

## 5. Main Modules

- **Board:** Manages the game board, validates moves, and checks for wins or draws.
- **Player:** Defines the common interface for players.
- **LocalPlayer:** Represents a local player.
- **WebSocketPlayer:** Represents a network-connected player.
- **AIPlayer:** Implements computer-controlled moves.
- **GameSession:** Manages turns and game state.
- **AuthManager:** Handles user authentication.
- **ServerNetworkManager:** Handles networking-related responsibilities.
