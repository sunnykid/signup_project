const { Pool } = require("pg");

let pool;

function getPgPool(env) {
  if (!pool) {
    pool = new Pool({
      host: env.PG_HOST,
      port: Number(env.PG_PORT || 5432),
      user: env.PG_USER,
      password: env.PG_PASSWORD,
      database: env.PG_DATABASE,
      max: 10
    });
  }
  return pool;
}

module.exports = { getPgPool };
