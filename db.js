/* =========================================================
   MySQL connection pool
   One shared pool is reused by every request.
   ========================================================= */

const mysql = require("mysql2/promise");
const { sslConfig } = require("./utils/db-ssl");

const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "eleczz",
    ssl: sslConfig(),

    waitForConnections: true,
    connectionLimit: 10,
    charset: "utf8mb4",

    // DATE columns come back as "2026-09-20" text instead of JS Date objects,
    // which is exactly the format the frontend already uses.
    dateStrings: true
});

module.exports = pool;
