require("dotenv").config();

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcrypt");

const mysql = require("mysql2/promise");
const redis = require("redis");

const createStore = require("./store"); // store/index.js

const app = express();
app.use(express.json());

// ✅ 기존 public 그대로 서빙 (경로 깨짐 방지)
const publicDirCandidates = [
  path.join(__dirname, "public"),
  path.join(process.cwd(), "public"),
];
const PUBLIC_DIR = publicDirCandidates.find((p) => fs.existsSync(p));
if (!PUBLIC_DIR) {
  console.error("[BOOT] public directory not found. checked:", publicDirCandidates);
} else {
  console.log("[BOOT] serving static from:", PUBLIC_DIR);
  app.use("/", express.static(PUBLIC_DIR));
}

// ---- env ----
const PORT = Number(process.env.PORT || 8080);

const MYSQL_HOST = process.env.MYSQL_HOST || "192.168.80.120";
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const MYSQL_USER = process.env.MYSQL_USER || "app";
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || "apppass";
const MYSQL_DB = process.env.MYSQL_DB || "auth_lab";

const REDIS_HOST = process.env.REDIS_HOST || "192.168.80.120";
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || 1800);
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 10);

// ---- connections ----
let mysqlPool;
let redisClient;
let store;

function makeToken() {
  return crypto.randomBytes(40).toString("hex");
}

function readBearerToken(req) {
  const h = req.headers["authorization"];
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function initMysql() {
  mysqlPool = mysql.createPool({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DB,
    waitForConnections: true,
    connectionLimit: 10,
  });

  await mysqlPool.query("SELECT 1");

  // 테이블(없으면 생성) - 기존과 동일하게 유지 가능
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id BIGINT PRIMARY KEY AUTO_INCREMENT,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token VARCHAR(128) PRIMARY KEY,
      payload TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_expires (expires_at)
    ) ENGINE=InnoDB;
  `);

  console.log("[BOOT] MySQL ready");
}

function initRedisOptional() {

redisClient = redis.createClient({
  url: `redis://${REDIS_HOST}:${REDIS_PORT}`,

  // ✅ 핵심: Redis down 시 명령을 큐에 쌓지 않고 즉시 에러로 반환
  disableOfflineQueue: true,

  socket: {
    connectTimeout: 800, // 연결 시도 0.8초 내 실패
    reconnectStrategy: (retries) => Math.min(retries * 500, 5000),
  },
});
  // Redis 에러로 서버가 죽으면 안 됨(옵셔널)
  let lastErrAt = 0;
  redisClient.on("error", (err) => {
    const now = Date.now();
    if (now - lastErrAt > 10_000) {
      console.error("[redis] error:", err.code || err.message);
      lastErrAt = now;
    }
  });

  redisClient.connect()
    .then(() => console.log("[BOOT] Redis connected"))
    .catch((err) => console.error("[BOOT] Redis connect failed (fallback mode):", err.code || err.message));
}

async function auth(req, res, next) {
  try {
    const token = readBearerToken(req);
    if (!token) return res.status(401).json({ error: "auth failed" });

    const out = await store.get(token); // { value, session_store, ... }
    if (!out.value) return res.status(401).json({ error: "auth failed" });

    req.token = token;
    req.session = out.value;
    req.session_store = out.session_store;
    next();
  } catch (e) {
    console.error("[auth] error:", e.code || e.message);
    res.status(500).json({ error: "internal_error" });
  }
}

// ---- API ----
// ✅ 기존 프론트가 호출하던 경로 유지(보통 /api/*)
app.post("/api/signup", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "bad_request" });

    const pwHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await mysqlPool.query("INSERT INTO users(email, password_hash) VALUES(?, ?)", [email, pwHash]);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "conflict" });
    console.error("[signup] error:", e.code || e.message);
    res.status(500).json({ error: "internal_error" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "bad_request" });

    const [rows] = await mysqlPool.query(
      "SELECT user_id, email, password_hash FROM users WHERE email=? LIMIT 1",
      [email]
    );
    if (!rows.length) return res.status(401).json({ error: "login_failed" });

    const u = rows[0];
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: "login_failed" });

    const token = makeToken();
    const sessionObj = { user_id: u.user_id, email: u.email };

    // ✅ Redis 우선 → 실패 시 MySQL
    const r = await store.set(token, sessionObj, SESSION_TTL_SECONDS);

    // ✅ 기존 프론트가 token만 쓰면 문제없게 유지 + store 정보는 “추가 필드”
    res.json({
      token,
      ttl_seconds: SESSION_TTL_SECONDS,
      session_store: r.session_store,
      ...(r.fallback_reason ? { fallback_reason: r.fallback_reason } : {}),
    });
  } catch (e) {
    console.error("[login] error:", e.code || e.message);
    res.status(500).json({ error: "internal_error" });
  }
});

app.get("/api/me", auth, async (req, res) => {
  // ✅ 기존 UI가 기대하는 형태 유지: user_id/email 제공
  res.json({ ok: true, user: req.session, session_store: req.session_store });
});

app.post("/api/logout", auth, async (req, res) => {
  await store.del(req.token);
  res.json({ ok: true });
});

app.get("/api/health", async (req, res) => {
  const out = { ok: true, mysql: false, redis: false, degraded: false };
  try { await mysqlPool.query("SELECT 1"); out.mysql = true; } catch {}
  try { await redisClient.ping(); out.redis = true; } catch {}
  out.ok = out.mysql;
  out.degraded = out.mysql && !out.redis;
  res.json(out);
});

// ✅ (선택) 기존 프로젝트가 /signup, /login 같은 “/api 없는 경로”였다면 호환 라우트 제공
app.post("/signup", (req, res) => app._router.handle({ ...req, url: "/api/signup" }, res, () => {}));
app.post("/login",  (req, res) => app._router.handle({ ...req, url: "/api/login"  }, res, () => {}));
app.get("/me",      (req, res) => app._router.handle({ ...req, url: "/api/me"     }, res, () => {}));
app.post("/logout", (req, res) => app._router.handle({ ...req, url: "/api/logout" }, res, () => {}));

async function main() {
  await initMysql();
  initRedisOptional();
  store = createStore({ redisClient, mysqlPool });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[BOOT] signup-lab running: http://0.0.0.0:${PORT}`);
    console.log(`[BOOT] MySQL is REQUIRED, Redis is OPTIONAL (fallback enabled)`);
  });
}

main().catch((e) => {
  console.error("[BOOT] fatal:", e);
  process.exit(1);
});

