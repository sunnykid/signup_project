// store/redisSessionStore.js
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timeout:${label}:${ms}ms`)), ms)
    ),
  ]);
}

module.exports = function createRedisSessionStore({ redisClient }) {
  // Redis 명령은 800ms 내에 끝나야 한다(실습용/안전용)
  const CMD_TIMEOUT_MS = 800;

  function ensureReady() {
    // isReady: 연결 준비 완료 상태
    // Redis down이면 여기서 바로 throw → fallback 유도
    if (!redisClient || !redisClient.isReady) {
      const err = new Error("redis_not_ready");
      err.code = "REDIS_NOT_READY";
      throw err;
    }
  }

  return {
    async set(token, obj, ttlSeconds) {
      ensureReady();
      const v = JSON.stringify(obj);
      await withTimeout(redisClient.setEx(`sess:${token}`, ttlSeconds, v), CMD_TIMEOUT_MS, "setEx");
      return true;
    },

    async get(token) {
      ensureReady();
      const v = await withTimeout(redisClient.get(`sess:${token}`), CMD_TIMEOUT_MS, "get");
      return v ? JSON.parse(v) : null;
    },

    async del(token) {
      // del은 실패해도 서비스 영향이 작으니, ready 체크는 선택
      if (!redisClient || !redisClient.isReady) return true;
      await withTimeout(redisClient.del(`sess:${token}`), CMD_TIMEOUT_MS, "del");
      return true;
    },
  };
};

