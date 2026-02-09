const createRedisStore = require("./redisSessionStore");
const createMysqlStore = require("./mysqlSessionStore");

function now() { return Date.now(); }

module.exports = function createStore({ redisClient, mysqlPool }) {
  const redisStore = createRedisStore({ redisClient });
  const mysqlStore  = createMysqlStore({ mysqlPool });

  // Redis 장애 시 잠깐 Redis 시도를 멈추는 "간단 회로차단기"
  let redisDownUntil = 0;
  const COOLDOWN_MS = 5000; // 5초 동안은 MySQL만 사용

  function redisAllowed() {
    return now() >= redisDownUntil;
  }
  function markRedisDown() {
    redisDownUntil = now() + COOLDOWN_MS;
  }

async function tryRedis(op) {
  // ✅ Redis가 연결 준비 상태가 아니면 즉시 실패 → MySQL fallback
  if (!redisClient || !redisClient.isReady) {
    const e = new Error("redis_not_ready");
    e.code = "REDIS_NOT_READY";
    throw e;
  }

  if (!redisAllowed()) throw new Error("redis temporarily disabled");

  try {
    return await op(redisStore);
  } catch (e) {
    markRedisDown();
    throw e;
  }
}

  return {
    async set(token, obj, ttlSeconds) {
      try {
        await tryRedis((s) => s.set(token, obj, ttlSeconds));
        return { session_store: "redis" };
      } catch (e) {
        await mysqlStore.set(token, obj, ttlSeconds);
        return { session_store: "mysql", fallback_reason: e.code || e.message };
      }
    },

    async get(token) {
      try {
        const v = await tryRedis((s) => s.get(token));
        if (v) return { value: v, session_store: "redis" };

        // Redis에 없으면(MySQL fallback로 저장된 경우) MySQL도 확인
        const mv = await mysqlStore.get(token);
        return { value: mv, session_store: mv ? "mysql" : "none" };
      } catch (e) {
        const mv = await mysqlStore.get(token);
        return { value: mv, session_store: mv ? "mysql" : "none", fallback_reason: e.code || e.message };
      }
    },

    async del(token) {
      // 삭제는 최대한 둘 다 시도
      try { await tryRedis((s) => s.del(token)); } catch (_) {}
      await mysqlStore.del(token);
      return true;
    }
  };
};
