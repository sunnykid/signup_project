const mysql = require("mysql2/promise");

let pool;

function getMysqlPool(env) {
  if (!pool) {
    pool = mysql.createPool({
      host: env.MYSQL_HOST,
      port: Number(env.MYSQL_PORT || 3306),
      user: env.MYSQL_USER,
      password: env.MYSQL_PASSWORD,
      database: env.MYSQL_DATABASE,
      connectionLimit: 10
    });
  }
  return pool;
}

module.exports = { getMysqlPool };
