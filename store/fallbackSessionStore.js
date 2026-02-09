const { createRedisSessionStore } = require("./redisSessionStore");
const { createMysqlSessionStore } = require("./mysqlSessionStore");

function createFallbackSessionStore({ redisClient, mysqlPool, breakerMs = 3000 }) {
  const redisStore = redisClient ? createRedisSessionStore(redisClient) : null;
  const mysqlStore = createMysqlSessionStore(mysqlPool);

  let redisDownUntil = 0;

  const redisUsableNow = () => redisStore && Date.now() >= redisDownUntil;
  const markRedisDown = () => { redisDownUntil = Date.now() + breakerMs; };

  return {
    async set(token, payloadObj, ttlSec) {
      // 장애 대비: MySQL에 항상 저장
      await mysqlStore.set(token, payloadObj, ttlSec);

      // 성능: Redis는 가능하면 저장(실패해도 로그인 성공)
      if (redisUsableNow()) {
        try {
          await redisStore.set(token, payloadObj, ttlSec);
        } catch (e) {
          markRedisDown();
          console.error("[fallback] Redis set failed -> keep MySQL only:", e.message);
        }
      }
    },

    async get(token) {
      // Redis 우선
      if (redisUsableNow()) {
        try {
          const v = await redisStore.get(token);
          if (v) return v;
        } catch (e) {
          markRedisDown();
          console.error("[fallback] Redis get failed -> fallback to MySQL:", e.message);
        }
      }
      // MySQL 폴백
      return await mysqlStore.get(token);
    },

    async del(token) {
      try { await mysqlStore.del(token); } catch (e) {
        console.error("[fallback] MySQL del failed:", e.message);
      }

      if (redisUsableNow()) {
        try { await redisStore.del(token); } catch (e) {
          markRedisDown();
          console.error("[fallback] Redis del failed:", e.message);
        }
      }
    },

    async cleanupExpired() {
      await mysqlStore.cleanupExpired();
    }
  };
}

module.exports = { createFallbackSessionStore };
