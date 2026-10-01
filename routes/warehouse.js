/* =========================================================
   /api/warehouse  -  the data warehouse page

   GET  /overview          ETL history, materialized views, partitions, freshness
   GET  /status            just the freshness (used by the BI page)
   POST /etl               run the ETL now        -> CALL sp_etl_run(...)
   POST /refresh-mv        rebuild materialized views -> CALL sp_refresh_mv(...)
   GET  /dimension/:kind   slowly-changing dimension history (customer | product)
   GET  /scd-report        revenue "as it was" versus "as it is today"
   GET  /pruning           EXPLAIN: which partitions does a date range read?
   ========================================================= */

const express = require("express");

const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { HttpError, requireDate, wrap } = require("../utils/helpers");

const router = express.Router();

router.use(requireAuth);

const RUN_COLUMNS = `run_id, as_of_date, started_at, finished_at, status,
                     customers_new, customers_changed, products_new, products_changed,
                     facts_inserted, facts_updated, facts_remapped, message,
                     TIMESTAMPDIFF(MICROSECOND, started_at, COALESCE(finished_at, NOW())) / 1000 AS duration_ms`;

const num = value => Number(value);

/* How far behind the warehouse is: changes made in the live tables since the last good ETL. */
async function getStatus(userId) {

    const [[last]] = await pool.query(
        `SELECT MAX(finished_at) AS finished_at FROM etl_run_log WHERE user_id = ? AND status = 'SUCCESS'`,
        [userId]
    );

    const [[orders]] = await pool.query(
        `SELECT COUNT(*) AS n
           FROM order_status_history h
           JOIN orders o ON o.order_id = h.order_id
          WHERE o.user_id = ? AND h.changed_at > COALESCE(?, '1970-01-01')`,
        [userId, last.finished_at]
    );

    const [[customers]] = await pool.query(
        `SELECT COUNT(*) AS n
           FROM customers c
           LEFT JOIN dw_dim_customer d ON d.customer_id = c.customer_id AND d.is_current = 1
          WHERE c.user_id = ?
            AND (d.customer_sk IS NULL OR d.city <> c.city OR d.name <> c.name OR d.email <> c.email)`,
        [userId]
    );

    const [[products]] = await pool.query(
        `SELECT COUNT(*) AS n
           FROM products p
           LEFT JOIN dw_dim_product d ON d.product_id = p.product_id AND d.is_current = 1
          WHERE p.user_id = ?
            AND (d.product_sk IS NULL OR d.category <> p.category OR d.list_price <> p.price
                 OR d.product_name <> p.product_name)`,
        [userId]
    );

    const pending = { orders: num(orders.n), customers: num(customers.n), products: num(products.n) };

    return {
        last_success_at: last.finished_at,
        pending,
        pending_total: pending.orders + pending.customers + pending.products,
        stale: pending.orders + pending.customers + pending.products > 0
    };
}

/* Read the partition list of the fact table and count THIS account's rows in each. */
async function getPartitions(userId) {

    const [parts] = await pool.query(
        `SELECT PARTITION_NAME AS name, PARTITION_DESCRIPTION AS description
           FROM information_schema.PARTITIONS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dw_fact_sales'
          ORDER BY PARTITION_ORDINAL_POSITION`
    );

    const result = [];
    let previous = null;

    for (const part of parts) {
        const [[count]] = await pool.query(
            `SELECT COUNT(*) AS n FROM dw_fact_sales PARTITION (\`${part.name}\`) WHERE user_id = ?`,
            [userId]
        );

        let range;
        if (part.description === "MAXVALUE") {
            range = previous ? `from ${previous} onwards` : "everything";
        } else {
            const d = String(part.description);
            const upper = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
            range = previous ? `${previous} to before ${upper}` : `before ${upper}`;
            previous = upper;
        }

        result.push({ name: part.name, range, rows: num(count.n) });
    }

    return result;
}

router.get("/status", wrap(async (req, res) => {
    res.json(await getStatus(req.userId));
}));

router.get("/overview", wrap(async (req, res) => {

    const uid = req.userId;

    const [runs] = await pool.query(
        `SELECT ${RUN_COLUMNS} FROM etl_run_log WHERE user_id = ? ORDER BY run_id DESC LIMIT 10`, [uid]);

    const [[cust]] = await pool.query(
        `SELECT COUNT(*) AS versions, SUM(is_current) AS current_rows,
                COUNT(DISTINCT customer_id) AS entities
           FROM dw_dim_customer WHERE user_id = ?`, [uid]);
    const [[prod]] = await pool.query(
        `SELECT COUNT(*) AS versions, SUM(is_current) AS current_rows,
                COUNT(DISTINCT product_id) AS entities
           FROM dw_dim_product WHERE user_id = ?`, [uid]);
    const [[fact]] = await pool.query(
        `SELECT COUNT(*) AS n, MIN(date_key) AS first_key, MAX(date_key) AS last_key
           FROM dw_fact_sales WHERE user_id = ?`, [uid]);

    const [mvs] = await pool.query(
        `SELECT mv_name, refreshed_at, row_count FROM mv_status WHERE user_id = ? ORDER BY mv_name`, [uid]);

    const [events] = await pool.query(
        `SELECT EVENT_NAME AS name, STATUS AS status, INTERVAL_VALUE AS every_n, INTERVAL_FIELD AS every_unit
           FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE()`);
    const [[scheduler]] = await pool.query("SELECT @@event_scheduler AS state");

    res.json({
        status: await getStatus(uid),
        runs: runs.map(r => ({ ...r, duration_ms: Math.round(num(r.duration_ms)) })),
        dimensions: {
            customer: {
                versions: num(cust.versions), current: num(cust.current_rows || 0),
                entities: num(cust.entities), historical: num(cust.versions) - num(cust.current_rows || 0)
            },
            product: {
                versions: num(prod.versions), current: num(prod.current_rows || 0),
                entities: num(prod.entities), historical: num(prod.versions) - num(prod.current_rows || 0)
            }
        },
        fact: { rows: num(fact.n) },
        materialized_views: mvs.map(m => ({ ...m, row_count: num(m.row_count) })),
        partitions: await getPartitions(uid),
        event: {
            scheduler: scheduler.state,
            jobs: events.map(e => ({ name: e.name, status: e.status, every: `${e.every_n} ${String(e.every_unit).toLowerCase()}` }))
        }
    });
}));

/* ---------- run the ETL ---------- */

router.post("/etl", wrap(async (req, res) => {

    try {
        await pool.query("CALL sp_etl_run(?, CURRENT_DATE)", [req.userId]);
    } catch (error) {
        // SIGNAL 45000 = a message the procedure wrote for the user (e.g. "already in progress")
        if (error.sqlState === "45000") throw new HttpError(409, error.sqlMessage);
        throw error;
    }

    const [[run]] = await pool.query(
        `SELECT ${RUN_COLUMNS} FROM etl_run_log WHERE user_id = ? ORDER BY run_id DESC LIMIT 1`, [req.userId]);

    res.json({ run: { ...run, duration_ms: Math.round(num(run.duration_ms)) }, status: await getStatus(req.userId) });
}));

/* ---------- rebuild the materialized views only ---------- */

router.post("/refresh-mv", wrap(async (req, res) => {

    const started = process.hrtime.bigint();
    await pool.query("CALL sp_refresh_mv(?)", [req.userId]);
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;

    const [mvs] = await pool.query(
        `SELECT mv_name, refreshed_at, row_count FROM mv_status WHERE user_id = ? ORDER BY mv_name`, [req.userId]);

    res.json({ elapsed_ms: Math.round(elapsed), materialized_views: mvs.map(m => ({ ...m, row_count: num(m.row_count) })) });
}));

/* ---------- SCD: the history of the dimensions ---------- */

router.get("/dimension/:kind", wrap(async (req, res) => {

    const kind = req.params.kind;
    const showAll = req.query.all === "1";

    const spec = {
        customer: {
            table: "dw_dim_customer", key: "customer_id",
            cols: "customer_id AS entity_id, name, city AS tracked_value, 'city' AS tracked_field, NULL AS extra"
        },
        product: {
            table: "dw_dim_product", key: "product_id",
            cols: "product_id AS entity_id, product_name AS name, category AS tracked_value, 'category' AS tracked_field, list_price AS extra"
        }
    }[kind];

    if (!spec) throw new HttpError(404, "Unknown dimension.");

    const changedOnly = showAll ? "" :
        `AND ${spec.key} IN (SELECT ${spec.key} FROM ${spec.table} WHERE user_id = ? GROUP BY ${spec.key} HAVING COUNT(*) > 1)`;

    const params = showAll ? [req.userId] : [req.userId, req.userId];

    const [rows] = await pool.query(
        `SELECT ${spec.cols}, version_no, effective_from, effective_to, is_current
           FROM ${spec.table}
          WHERE user_id = ? ${changedOnly}
          ORDER BY ${spec.key}, version_no
          LIMIT 300`, params);

    const [[totals]] = await pool.query(
        `SELECT COUNT(*) AS versions, COUNT(DISTINCT ${spec.key}) AS entities FROM ${spec.table} WHERE user_id = ?`,
        [req.userId]);

    res.json({
        kind,
        type2_fields: kind === "customer" ? ["city"] : ["category", "list_price"],
        type1_fields: kind === "customer" ? ["name", "email"] : ["product_name"],
        total_versions: num(totals.versions),
        total_entities: num(totals.entities),
        rows: rows.map(r => ({ ...r, extra: r.extra === null ? null : num(r.extra), is_current: !!r.is_current }))
    });
}));

/* ---------- SCD: as-was versus as-is ---------- */

async function asWasVsAsIs(userId, wasColumn, nowColumn) {

    const [was] = await pool.query(
        `SELECT ${wasColumn} AS name, SUM(line_amount) AS revenue
           FROM v_dw_sales WHERE user_id = ? AND order_status = 'COMPLETED' GROUP BY ${wasColumn}`, [userId]);
    const [now] = await pool.query(
        `SELECT ${nowColumn} AS name, SUM(line_amount) AS revenue
           FROM v_dw_sales WHERE user_id = ? AND order_status = 'COMPLETED' GROUP BY ${nowColumn}`, [userId]);

    const merged = new Map();
    for (const r of was) merged.set(r.name, { name: r.name, as_was: num(r.revenue), as_is: 0 });
    for (const r of now) {
        const row = merged.get(r.name) || { name: r.name, as_was: 0, as_is: 0 };
        row.as_is = num(r.revenue);
        merged.set(r.name, row);
    }

    return [...merged.values()]
        .map(r => ({ ...r, difference: Math.round((r.as_is - r.as_was) * 100) / 100 }))
        .sort((a, b) => Math.max(b.as_was, b.as_is) - Math.max(a.as_was, a.as_is))
        .slice(0, 25);
}

router.get("/scd-report", wrap(async (req, res) => {
    res.json({
        by_city: await asWasVsAsIs(req.userId, "customer_city", "customer_city_now"),
        by_category: await asWasVsAsIs(req.userId, "category", "category_now")
    });
}));

/* ---------- partition pruning demo ---------- */

router.get("/pruning", wrap(async (req, res) => {

    const from = requireDate(req.query.from, "From date");
    const to = requireDate(req.query.to, "To date");

    if (from > to) throw new HttpError(400, "The 'from' date must not be after the 'to' date.");

    const key = date => Number(date.replace(/-/g, ""));

    const [plan] = await pool.query(
        `EXPLAIN SELECT SUM(line_amount) FROM dw_fact_sales
          WHERE user_id = ? AND date_key BETWEEN ? AND ?`,
        [req.userId, key(from), key(to)]);

    const used = plan[0].partitions ? String(plan[0].partitions).split(",") : [];

    const [all] = await pool.query(
        `SELECT COUNT(*) AS n FROM information_schema.PARTITIONS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dw_fact_sales'`);

    const [[result]] = await pool.query(
        `SELECT COALESCE(SUM(line_amount), 0) AS revenue, COUNT(*) AS \`lines\` FROM dw_fact_sales
          WHERE user_id = ? AND date_key BETWEEN ? AND ?`,
        [req.userId, key(from), key(to)]);

    res.json({
        from, to,
        partitions_read: used,
        partitions_total: num(all[0].n),
        revenue: num(result.revenue),
        lines: num(result.lines),
        sql: `SELECT SUM(line_amount) FROM dw_fact_sales WHERE user_id = ${req.userId} AND date_key BETWEEN ${key(from)} AND ${key(to)}`
    });
}));

module.exports = router;
