const { createRedisSessionStore } = require("./redisSessionStore");
const { createMysqlSessionStore } = require("./mysqlSessionStore");
const { createFallbackSessionStore } = require("./fallbackSessionStore");

function createSessionStore({ type, redisClient, mysqlPool }) {
  const t = (type || "redis").toLowerCase().trim();

  if (t === "mysql") return createMysqlSessionStore(mysqlPool);
  if (t === "fallback") return createFallbackSessionStore({ redisClient, mysqlPool, breakerMs: 3000 });

  return createRedisSessionStore(redisClient);
}

module.exports = { createSessionStore };
