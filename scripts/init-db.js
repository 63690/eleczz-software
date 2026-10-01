/* =========================================================
   npm run setup-db

   1. creates the database (name from .env) and all tables
   2. upgrades an older database in place (constraints, indexes)
   3. creates the reporting VIEWS   (sql/05_views.sql)
   4. creates the TRIGGERS + STORED PROCEDURES (sql/07_routines_triggers.sql)
   5. creates the DATA WAREHOUSE tables          (db/warehouse.sql)
   6. creates the FUNCTIONS, ETL + ROUTINES      (db/routines.sql)
   7. runs the ETL once, so the warehouse is filled straight away

   Safe to run as often as you like - it never deletes data.
   ========================================================= */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { sslConfig } = require("../utils/db-ssl");
const upgrades = require("./upgrades");
const { splitStatements, withoutDatabaseSwitching } = require("./sqlfile");

const ROOT = path.join(__dirname, "..");

/* Keep only the DDL (DROP / CREATE); example SELECT / CALL lines are skipped. */
function ddlOnly(file) {
    return splitStatements(fs.readFileSync(path.join(ROOT, file), "utf8"))
        .filter(statement => /^(DROP|CREATE)\b/i.test(statement));
}

async function indexExists(connection, table, name) {
    const [rows] = await connection.query(
        `SELECT 1 FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
        [table, name]
    );
    return rows.length > 0;
}

async function checkExists(connection, name) {
    const [rows] = await connection.query(
        `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = ?
            AND CONSTRAINT_TYPE = 'CHECK' LIMIT 1`,
        [name]
    );
    return rows.length > 0;
}

async function applyUpgrades(connection) {

    let applied = 0;

    for (const step of upgrades) {

        try {
            if (step.kind === "index" || step.kind === "unique") {
                if (await indexExists(connection, step.table, step.name)) continue;
                await connection.query(step.sql);
                console.log(`  + added ${step.kind === "unique" ? "unique key" : "index"} ${step.name}`);
                applied++;

            } else if (step.kind === "check") {
                if (await checkExists(connection, step.name)) continue;
                await connection.query(step.sql);
                console.log(`  + added CHECK constraint ${step.name}`);
                applied++;

            } else if (step.kind === "drop_index") {
                // remove an old, now-redundant index - only once its replacement exists
                if (!(await indexExists(connection, step.table, step.name))) continue;
                if (!(await indexExists(connection, step.table, step.replacedBy))) continue;
                await connection.query(`ALTER TABLE \`${step.table}\` DROP INDEX \`${step.name}\``);
                console.log(`  - dropped redundant index ${step.name}`);
                applied++;

            } else if (step.kind === "always") {
                const [result] = await connection.query(step.sql);
                if (result.affectedRows) {
                    console.log(`  + ${step.name}: ${result.affectedRows} row(s)`);
                    applied++;
                }
            }

        } catch (error) {
            console.log(`  ! could not apply ${step.name}: ${error.message}`);
            if (step.hint) console.log(`    -> ${step.hint}`);
        }
    }

    if (!applied) console.log("  (already up to date)");
}

async function main() {

    const dbName = process.env.DB_NAME || "eleczz";

    if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
        throw new Error("DB_NAME may only contain letters, numbers and underscores.");
    }

    // schema.sql starts with CREATE DATABASE / USE for people who run it by hand
    // in MySQL Workbench. Here we use DB_NAME from .env instead.
    const schema = fs
        .readFileSync(path.join(ROOT, "db", "schema.sql"), "utf8")
        .replace(/CREATE DATABASE[^;]*;/i, "")
        .replace(/^USE\s+[^;]*;/im, "");

    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || "localhost",
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || "root",
        password: process.env.DB_PASSWORD || "",
        ssl: sslConfig(),
        multipleStatements: true
    });

    const [[versionRow]] = await connection.query("SELECT VERSION() AS v");
    const [major, minor, patch] = versionRow.v.split(/[.\-]/).map(n => parseInt(n, 10));
    const meetsMinimum = major > 8 || (major === 8 && (minor > 0 || patch >= 18));

    if (major < 8) {
        throw new Error(
            `MySQL ${versionRow.v} is too old. This project needs MySQL 8.0.18 or newer ` +
            `(window functions, CTEs, CHECK constraints, EXPLAIN ANALYZE).`
        );
    }

    if (!meetsMinimum) {
        throw new Error(
            `MySQL ${versionRow.v} is too old. This project needs MySQL 8.0.18 or newer: ` +
            `CHECK constraints need 8.0.16+ and EXPLAIN ANALYZE (used in sql/08_query_optimization.sql) ` +
            `needs 8.0.18+. Please upgrade MySQL and run this again.`
        );
    }

    console.log(`\nMySQL ${versionRow.v}  ->  database "${dbName}"`);

    await connection.query(
        `CREATE DATABASE IF NOT EXISTS \`${dbName}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await connection.query(`USE \`${dbName}\``);

    console.log("\n[1/7] Tables");
    await connection.query(schema);
    console.log("  tables are in place");

    console.log("\n[2/7] Upgrading older databases (constraints + indexes)");
    await applyUpgrades(connection);

    console.log("\n[3/7] Views");
    for (const statement of ddlOnly("sql/05_views.sql")) {
        await connection.query(statement);
    }
    console.log("  views created / refreshed");

    console.log("\n[4/7] Triggers + stored procedures");
    let routineErrors = 0;
    for (const statement of ddlOnly("sql/07_routines_triggers.sql")) {
        try {
            await connection.query(statement);
        } catch (error) {
            routineErrors++;
            console.log(`  ! skipped: ${error.message}`);
        }
    }
    console.log(routineErrors
        ? "  (some routines were skipped - the app still works; see message above)"
        : "  triggers + procedures created / refreshed");


    console.log("\n[5/7] Data warehouse tables (star schema, partitions, materialized views)");
    for (const statement of withoutDatabaseSwitching(
            splitStatements(fs.readFileSync(path.join(ROOT, "db", "warehouse.sql"), "utf8")))) {
        await connection.query(statement);
    }
    console.log("  warehouse tables + view v_dw_sales are in place");

    console.log("\n[6/7] Functions, ETL procedures, scheduled event");
    let warehouseRoutineErrors = 0;
    for (const statement of withoutDatabaseSwitching(
            splitStatements(fs.readFileSync(path.join(ROOT, "db", "routines.sql"), "utf8")))) {
        try {
            await connection.query(statement);
        } catch (error) {
            warehouseRoutineErrors++;
            console.log(`  ! skipped: ${error.message}`);
            if (error.errno === 1419 || error.errno === 1227 || error.errno === 1418) {
                console.log("    -> your MySQL user lacks a privilege for stored routines. Run setup-db as root.");
            }
        }
    }
    console.log(warehouseRoutineErrors
        ? "  (some routines were skipped - see the messages above)"
        : "  routines created / refreshed");

    console.log("\n[7/7] First warehouse load (ETL)");
    try {
        await connection.query("CALL sp_etl_run_all(CURRENT_DATE)");
        const [[etl]] = await connection.query(
            `SELECT SUM(status = 'SUCCESS') AS ok, SUM(status = 'FAILED') AS failed
               FROM etl_run_log WHERE started_at >= NOW() - INTERVAL 5 MINUTE`);
        const [[facts]] = await connection.query("SELECT COUNT(*) AS n FROM dw_fact_sales");
        console.log(`  ETL ran for ${Number(etl.ok || 0)} account(s)` +
                    (Number(etl.failed) ? `, ${etl.failed} FAILED (see table etl_run_log)` : "") +
                    `; the fact table holds ${facts.n} order lines`);
    } catch (error) {
        console.log(`  ! ETL skipped: ${error.message}`);
    }

    /* ---------- summary ---------- */
    const [tables]   = await connection.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
    const [views]    = await connection.query("SHOW FULL TABLES WHERE Table_type = 'VIEW'");
    const [triggers] = await connection.query("SHOW TRIGGERS");
    const [procs]    = await connection.query("SHOW PROCEDURE STATUS WHERE Db = DATABASE()");
    const [funcs]    = await connection.query("SHOW FUNCTION STATUS WHERE Db = DATABASE()");
    const [events]   = await connection.query("SHOW EVENTS");
    const [[sched]]  = await connection.query("SELECT @@event_scheduler AS s");

    console.log(`\nDatabase "${dbName}" is ready.`);
    console.log("  Tables    : " + tables.map(r => Object.values(r)[0]).join(", "));
    console.log("  Views     : " + views.map(r => Object.values(r)[0]).join(", "));
    console.log("  Triggers  : " + triggers.map(r => r.Trigger).join(", "));
    console.log("  Procedures: " + procs.map(r => r.Name).join(", "));
    console.log("  Functions : " + funcs.map(r => r.Name).join(", "));
    console.log("  Events    : " + (events.map(r => `${r.Name} (${r.Status})`).join(", ") || "none") +
                `   [event scheduler: ${sched.s}]`);
    console.log("\nNext:  npm run seed   (optional demo data)   then   npm start\n");

    await connection.end();
}

main().catch(error => {
    console.error("\n[ERROR] Database setup failed: " + error.message + "\n");
    process.exit(1);
});
