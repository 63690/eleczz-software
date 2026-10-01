/* =========================================================
   npm run seed
   Loads db/seed.sql: a demo account with realistic customers,
   products, orders, order items and payments.

     login    : demo@eleczz.com
     password : Demo@123

   Safe to run again - it replaces the previous demo data only.
   Your own accounts and data are never touched.
   ========================================================= */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { sslConfig } = require("../utils/db-ssl");

async function main() {

    const sql = fs.readFileSync(path.join(__dirname, "..", "db", "seed.sql"), "utf8");

    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || "localhost",
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || "root",
        password: process.env.DB_PASSWORD || "",
        database: process.env.DB_NAME || "eleczz",
        ssl: sslConfig(),
        multipleStatements: true
    });

    // the file is one connection-wide script, so @variables (@uid, @c0 ...) persist
    const results = await connection.query(sql);

    // the last result set is the self-check SELECT at the bottom of seed.sql
    const summary = results[0][results[0].length - 1][0];

    // give the demo account a past (city moves, price changes) for the warehouse's SCD demo
    const historySql = fs.readFileSync(path.join(__dirname, "..", "db", "seed_history.sql"), "utf8");
    const historyResults = await connection.query(historySql);
    const warehouse = historyResults[0][historyResults[0].length - 1][0];

    console.log("\nDemo data loaded:");
    console.log(`  ${summary.customers} customers, ${summary.products} products, ${summary.orders} orders,`);
    console.log(`  ${summary.order_items} order items, ${summary.payments} payments`);
    console.log("Data warehouse loaded:");
    console.log(`  ${warehouse.fact_rows} fact rows, ${warehouse.customer_versions} customer versions, ` +
                `${warehouse.product_versions} product versions (${warehouse.etl_runs} ETL runs)`);
    console.log("\nLog in on the website with:");
    console.log("  email    : demo@eleczz.com");
    console.log("  password : Demo@123\n");

    await connection.end();
}

main().catch(error => {
    if (error.code === "ER_SP_DOES_NOT_EXIST") {
        console.error("\n[ERROR] The warehouse routines are missing. Run  npm run setup-db  first.\n");
    } else if (error.code === "ER_NO_SUCH_TABLE" || error.code === "ER_BAD_DB_ERROR") {
        console.error("\n[ERROR] The tables do not exist yet. Run  npm run setup-db  first.\n");
    } else {
        console.error("\n[ERROR] Seeding failed: " + error.message + "\n");
    }
    process.exit(1);
});
