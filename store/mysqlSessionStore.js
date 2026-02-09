module.exports = function createMysqlSessionStore({ mysqlPool }) {
  return {
    async set(token, obj, ttlSeconds) {
      const payload = JSON.stringify(obj);
      await mysqlPool.query(
        `INSERT INTO sessions(token, payload, expires_at)
         VALUES(?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))
         ON DUPLICATE KEY UPDATE payload=VALUES(payload), expires_at=VALUES(expires_at)`,
        [token, payload, ttlSeconds]
      );
      return true;
    },

    async get(token) {
      const [rows] = await mysqlPool.query(
        `SELECT payload
           FROM sessions
          WHERE token=? AND expires_at > NOW()
          LIMIT 1`,
        [token]
      );
      if (!rows.length) return null;
      return JSON.parse(rows[0].payload);
    },

    async del(token) {
      await mysqlPool.query(`DELETE FROM sessions WHERE token=?`, [token]);
      return true;
    }
  };
};
