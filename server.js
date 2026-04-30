const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID, randomBytes, scryptSync, timingSafeEqual } = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 3000;
const publicDir = path.join(__dirname, "public");
const projectDataDir = path.join(__dirname, "data");
const dataDir = process.env.DATA_DIR || projectDataDir;
const databaseFile = process.env.DATABASE_FILE || path.join(dataDir, "app.db");
const boardFile = path.join(projectDataDir, "board.json");
const usersFile = path.join(projectDataDir, "users.json");
const sessionsFile = path.join(projectDataDir, "sessions.json");

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;
const LIMITS = {
  name: 60,
  email: 120,
  passwordMin: 8,
  passwordMax: 128,
  columnTitle: 40,
  taskTitle: 80,
  taskDescription: 400
};

const defaultBoard = {
  boardName: "My First Task Board",
  columns: [
    {
      id: "todo",
      title: "To Do",
      tasks: [
        {
          id: randomUUID(),
          title: "Set up the project",
          description: "Create the Node.js app and make sure it runs."
        }
      ]
    },
    {
      id: "doing",
      title: "Doing",
      tasks: [
        {
          id: randomUUID(),
          title: "Build the first API route",
          description: "Return the board as JSON from the server."
        }
      ]
    },
    {
      id: "done",
      title: "Done",
      tasks: [
        {
          id: randomUUID(),
          title: "Choose a project idea",
          description: "Pick a simple web app you can finish."
        }
      ]
    }
  ]
};

function createPasswordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function validateLength(value, maxLength) {
  return value.length > 0 && value.length <= maxLength;
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  return password.length >= LIMITS.passwordMin && password.length <= LIMITS.passwordMax;
}

// Hash the incoming password again and compare the bytes safely.
function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(":")) {
    return false;
  }

  const [salt, savedHash] = storedHash.split(":");
  const derivedHash = scryptSync(password, salt, 64);
  const savedBuffer = Buffer.from(savedHash, "hex");

  if (derivedHash.length !== savedBuffer.length) {
    return false;
  }

  return timingSafeEqual(derivedHash, savedBuffer);
}

function defaultUsers() {
  return [
    {
      id: "demo-user",
      name: "Demo User",
      email: "demo@example.com",
      passwordHash: createPasswordHash("password123")
    }
  ];
}

function ensureDataDirectory() {
  const databaseDir = path.dirname(databaseFile);

  if (!fs.existsSync(databaseDir)) {
    fs.mkdirSync(databaseDir, { recursive: true });
  }
}

function readJsonFile(filePath, fallbackValue) {
  if (!fs.existsSync(filePath)) {
    return fallbackValue;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function createDatabase() {
  ensureDataDirectory();
  const database = new DatabaseSync(databaseFile);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  return database;
}

const db = createDatabase();

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS board (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      title TEXT NOT NULL,
      position INTEGER NOT NULL,
      FOREIGN KEY (board_id) REFERENCES board(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      column_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL,
      FOREIGN KEY (column_id) REFERENCES columns(id) ON DELETE CASCADE
    );
  `);

  const boardRow = db.prepare("SELECT id FROM board LIMIT 1").get();

  if (!boardRow) {
    importLegacyData();
  }

  ensureDemoUser();
}

function importLegacyData() {
  const board = readJsonFile(boardFile, defaultBoard);
  const users = readJsonFile(usersFile, defaultUsers());
  const sessions = readJsonFile(sessionsFile, []);

  db.prepare("INSERT INTO board (id, name) VALUES (?, ?)").run("main-board", board.boardName || "My First Task Board");

  const insertColumn = db.prepare("INSERT INTO columns (id, board_id, title, position) VALUES (?, ?, ?, ?)");
  const insertTask = db.prepare("INSERT INTO tasks (id, column_id, title, description, position) VALUES (?, ?, ?, ?, ?)");

  board.columns.forEach((column, columnIndex) => {
    const columnId = column.id || randomUUID();
    insertColumn.run(columnId, "main-board", column.title, columnIndex);

    column.tasks.forEach((task, taskIndex) => {
      insertTask.run(
        task.id || randomUUID(),
        columnId,
        task.title,
        task.description || "",
        taskIndex
      );
    });
  });

  const insertUser = db.prepare("INSERT OR REPLACE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)");

  users.forEach((user) => {
    const passwordHash = user.passwordHash && user.passwordHash.includes(":")
      ? user.passwordHash
      : createPasswordHash("password123");

    insertUser.run(user.id || randomUUID(), user.name, user.email.toLowerCase(), passwordHash);
  });

  const insertSession = db.prepare("INSERT OR REPLACE INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)");

  sessions.forEach((session) => {
    const userExists = db.prepare("SELECT id FROM users WHERE id = ?").get(session.userId);

    if (userExists) {
      insertSession.run(session.token, session.userId, session.createdAt || new Date().toISOString());
    }
  });
}

function ensureDemoUser() {
  const demoUser = db.prepare("SELECT id, password_hash FROM users WHERE id = ?").get("demo-user");

  if (!demoUser) {
    db.prepare("INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)")
      .run("demo-user", "Demo User", "demo@example.com", createPasswordHash("password123"));
    return;
  }

  if (!demoUser.password_hash.includes(":")) {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .run(createPasswordHash("password123"), "demo-user");
  }
}

initializeDatabase();

function getBoardRow() {
  return db.prepare("SELECT id, name FROM board LIMIT 1").get();
}

function getNextPosition(tableName, foreignKeyColumn, foreignKeyValue) {
  const row = db.prepare(`SELECT COALESCE(MAX(position), -1) AS max_position FROM ${tableName} WHERE ${foreignKeyColumn} = ?`)
    .get(foreignKeyValue);

  return row.max_position + 1;
}

// Rebuild the old board JSON shape from normalized SQLite rows.
function readBoard() {
  const board = getBoardRow();
  const columns = db.prepare(
    "SELECT id, title, position FROM columns WHERE board_id = ? ORDER BY position, rowid"
  ).all(board.id);
  const tasksByColumn = db.prepare(
    "SELECT id, column_id, title, description, position FROM tasks ORDER BY position, rowid"
  ).all();

  return {
    boardName: board.name,
    columns: columns.map((column) => ({
      id: column.id,
      title: column.title,
      tasks: tasksByColumn
        .filter((task) => task.column_id === column.id)
        .map((task) => ({
          id: task.id,
          title: task.title,
          description: task.description
        }))
    }))
  };
}

function findColumn(columnId) {
  return db.prepare("SELECT id, board_id, title, position FROM columns WHERE id = ?").get(columnId);
}

function findTask(taskId) {
  return db.prepare("SELECT id, column_id, title, description, position FROM tasks WHERE id = ?").get(taskId);
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email
  };
}

function readUserByEmail(email) {
  return db.prepare("SELECT id, name, email, password_hash FROM users WHERE email = ?").get(email.toLowerCase());
}

function readUserById(userId) {
  return db.prepare("SELECT id, name, email, password_hash FROM users WHERE id = ?").get(userId);
}

// Sessions connect a browser cookie to a user record without storing the password in the cookie.
function createSession(userId) {
  const token = randomUUID();

  db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)")
    .run(token, userId, new Date().toISOString());

  return token;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || "application/octet-stream";

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, 404, { error: "File not found" });
      return;
    }

    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  });
}

function setSessionCookie(res, token) {
  const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const maxAgeSeconds = Math.floor(SESSION_MAX_AGE_MS / 1000);
  res.setHeader("Set-Cookie", `sessionToken=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secureFlag}`);
}

function clearSessionCookie(res) {
  const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `sessionToken=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureFlag}`);
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || "";
  const cookies = {};

  cookieHeader.split(";").forEach((cookie) => {
    const [name, ...rest] = cookie.trim().split("=");

    if (!name) {
      return;
    }

    cookies[name] = decodeURIComponent(rest.join("="));
  });

  return cookies;
}

function collectRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    // Incoming request bodies arrive in chunks, so we rebuild the full JSON string.
    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function getSessionUser(req) {
  const cookies = parseCookies(req);
  const token = cookies.sessionToken;

  if (!token) {
    return null;
  }

  const session = db.prepare("SELECT token, user_id, created_at FROM sessions WHERE token = ?").get(token);

  if (!session) {
    return null;
  }

  const sessionAgeMs = Date.now() - new Date(session.created_at).getTime();

  if (!Number.isFinite(sessionAgeMs) || sessionAgeMs > SESSION_MAX_AGE_MS) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }

  return readUserById(session.user_id) || null;
}

function removeSession(req) {
  const cookies = parseCookies(req);
  const token = cookies.sessionToken;

  if (!token) {
    return;
  }

  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

// Keep API routing in one place so the main server only decides between API and static files.
async function handleApi(req, res, url) {
  if (!url.pathname.startsWith("/api/")) {
    return false;
  }

  if (req.method === "POST" && url.pathname === "/api/register") {
    const body = await collectRequestBody(req);
    const name = normalizeText(body.name);
    const email = normalizeText(body.email).toLowerCase();
    const password = body.password || "";

    if (!name || !email || !password) {
      sendJson(res, 400, { error: "Name, email, and password are required." });
      return true;
    }

    if (!validateLength(name, LIMITS.name)) {
      sendJson(res, 400, { error: `Name must be between 1 and ${LIMITS.name} characters.` });
      return true;
    }

    if (!validateLength(email, LIMITS.email) || !validateEmail(email)) {
      sendJson(res, 400, { error: "Please enter a valid email address." });
      return true;
    }

    if (!validatePassword(password)) {
      sendJson(res, 400, { error: `Password must be between ${LIMITS.passwordMin} and ${LIMITS.passwordMax} characters.` });
      return true;
    }

    if (readUserByEmail(email)) {
      sendJson(res, 400, { error: "An account with that email already exists." });
      return true;
    }

    const user = {
      id: randomUUID(),
      name,
      email,
      password_hash: createPasswordHash(password)
    };

    db.prepare("INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)")
      .run(user.id, user.name, user.email, user.password_hash);

    const token = createSession(user.id);
    setSessionCookie(res, token);
    sendJson(res, 201, { user: sanitizeUser(user) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await collectRequestBody(req);
    const email = normalizeText(body.email).toLowerCase();
    const password = body.password || "";

    if (!validateLength(email, LIMITS.email) || !validatePassword(password)) {
      sendJson(res, 401, { error: "Incorrect email or password." });
      return true;
    }

    const user = readUserByEmail(email);

    if (!user || !verifyPassword(password, user.password_hash)) {
      sendJson(res, 401, { error: "Incorrect email or password." });
      return true;
    }

    const token = createSession(user.id);
    setSessionCookie(res, token);
    sendJson(res, 200, { user: sanitizeUser(user) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    removeSession(req);
    clearSessionCookie(res);
    sendJson(res, 200, { success: true });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/session") {
    const user = getSessionUser(req);

    if (!user) {
      sendJson(res, 401, { error: "Not logged in." });
      return true;
    }

    sendJson(res, 200, { user: sanitizeUser(user) });
    return true;
  }

  const sessionUser = getSessionUser(req);

  // Everything below this line is protected and requires a valid session cookie.
  if (!sessionUser) {
    sendJson(res, 401, { error: "Please log in first." });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/board") {
    sendJson(res, 200, readBoard());
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/columns") {
    const body = await collectRequestBody(req);
    const board = getBoardRow();
    const title = normalizeText(body.title);

    if (!validateLength(title, LIMITS.columnTitle)) {
      sendJson(res, 400, { error: `Column title must be between 1 and ${LIMITS.columnTitle} characters.` });
      return true;
    }

    const newColumn = {
      id: randomUUID(),
      title
    };

    db.prepare("INSERT INTO columns (id, board_id, title, position) VALUES (?, ?, ?, ?)")
      .run(newColumn.id, board.id, newColumn.title, getNextPosition("columns", "board_id", board.id));

    sendJson(res, 201, { ...newColumn, tasks: [] });
    return true;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/columns/")) {
    const columnId = url.pathname.split("/").pop();
    const body = await collectRequestBody(req);
    const column = findColumn(columnId);
    const title = normalizeText(body.title);

    if (!column) {
      sendJson(res, 404, { error: "Column not found." });
      return true;
    }

    if (!validateLength(title, LIMITS.columnTitle)) {
      sendJson(res, 400, { error: `Column title must be between 1 and ${LIMITS.columnTitle} characters.` });
      return true;
    }

    db.prepare("UPDATE columns SET title = ? WHERE id = ?").run(title, columnId);
    sendJson(res, 200, { ...column, title });
    return true;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/columns/")) {
    const columnId = url.pathname.split("/").pop();
    const column = findColumn(columnId);

    if (!column) {
      sendJson(res, 404, { error: "Column not found." });
      return true;
    }

    db.prepare("DELETE FROM columns WHERE id = ?").run(columnId);
    sendJson(res, 200, { success: true });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/tasks") {
    const body = await collectRequestBody(req);
    const column = findColumn(body.columnId);
    const title = normalizeText(body.title);
    const description = normalizeText(body.description);

    if (!column) {
      sendJson(res, 404, { error: "Column not found." });
      return true;
    }

    if (!validateLength(title, LIMITS.taskTitle)) {
      sendJson(res, 400, { error: `Task title must be between 1 and ${LIMITS.taskTitle} characters.` });
      return true;
    }

    if (description.length > LIMITS.taskDescription) {
      sendJson(res, 400, { error: `Task description must be ${LIMITS.taskDescription} characters or fewer.` });
      return true;
    }

    const task = {
      id: randomUUID(),
      title,
      description
    };

    db.prepare("INSERT INTO tasks (id, column_id, title, description, position) VALUES (?, ?, ?, ?, ?)")
      .run(task.id, column.id, task.title, task.description, getNextPosition("tasks", "column_id", column.id));

    sendJson(res, 201, task);
    return true;
  }

  if (req.method === "PATCH" && url.pathname === "/api/tasks/move") {
    const body = await collectRequestBody(req);
    const task = findTask(body.taskId);
    const fromColumn = findColumn(body.fromColumnId);
    const toColumn = findColumn(body.toColumnId);

    if (!task) {
      sendJson(res, 404, { error: "Task not found." });
      return true;
    }

    if (!fromColumn || !toColumn) {
      sendJson(res, 404, { error: "Column not found." });
      return true;
    }

    db.prepare("UPDATE tasks SET column_id = ?, position = ? WHERE id = ?")
      .run(toColumn.id, getNextPosition("tasks", "column_id", toColumn.id), task.id);

    sendJson(res, 200, { ...task, column_id: toColumn.id });
    return true;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/tasks/")) {
    const taskId = url.pathname.split("/").pop();
    const body = await collectRequestBody(req);
    const task = findTask(taskId);

    if (!task) {
      sendJson(res, 404, { error: "Task not found." });
      return true;
    }

    const title = normalizeText(body.title);
    const description = normalizeText(body.description);

    if (!validateLength(title, LIMITS.taskTitle)) {
      sendJson(res, 400, { error: `Task title must be between 1 and ${LIMITS.taskTitle} characters.` });
      return true;
    }

    if (description.length > LIMITS.taskDescription) {
      sendJson(res, 400, { error: `Task description must be ${LIMITS.taskDescription} characters or fewer.` });
      return true;
    }

    db.prepare("UPDATE tasks SET title = ?, description = ? WHERE id = ?")
      .run(title, description, taskId);

    sendJson(res, 200, { ...task, title, description });
    return true;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/tasks/")) {
    const taskId = url.pathname.split("/").pop();
    const task = findTask(taskId);

    if (!task) {
      sendJson(res, 404, { error: "Task not found." });
      return true;
    }

    db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
    sendJson(res, 200, { success: true });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        database: path.basename(databaseFile)
      });
      return;
    }

    const handled = await handleApi(req, res, url);

    if (handled) {
      return;
    }

    const sessionUser = getSessionUser(req);

    if (req.method === "GET" && url.pathname === "/login") {
      if (sessionUser) {
        redirect(res, "/");
        return;
      }

      sendFile(res, path.join(publicDir, "login.html"));
      return;
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      if (!sessionUser) {
        redirect(res, "/login");
        return;
      }

      sendFile(res, path.join(publicDir, "index.html"));
      return;
    }

    if (req.method === "GET") {
      // Only allow files from the public folder to avoid serving arbitrary local files.
      const requestedPath = path.normalize(path.join(publicDir, url.pathname));

      if (!requestedPath.startsWith(publicDir)) {
        sendJson(res, 403, { error: "Forbidden" });
        return;
      }

      sendFile(res, requestedPath);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Task board running at http://${HOST}:${PORT}`);
});
