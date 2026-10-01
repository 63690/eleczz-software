/* =========================================================
   BI DASHBOARD ENGINE  (the "Power BI" of this website)

   The browser never sends SQL. It sends a small description:
       { dataset: "sales", chart: "bar", dimension: "category",
         measures: ["revenue"], filters: [...], limit: 10 }
   and this file turns it into ONE parameterised SELECT.

   Safety:  every table and column name comes from the DATASETS
            list below (a whitelist). Values are always passed as
            ? parameters. The account filter (user_id = ?) is added
            here, so a widget can never read another account's data.
   ========================================================= */

const mysqlFormat = require("mysql2").format;

const pool = require("../db");
const { HttpError, requireDate, requireInt } = require("./helpers");

const CHARTS = ["bar", "line", "pie", "doughnut", "table", "kpi"];

/* ---------------------------------------------------------
   DATA SOURCES
   dimensions = things you can group by     (X axis / slices)
   measures   = numbers you can calculate   (Y axis / KPI)
   --------------------------------------------------------- */
const DATASETS = {

    sales: {
        label: "Sales (star schema)",
        description: "Every order line, joined to the date, customer and product dimensions. " +
                     "\"as-was\" fields show the value at the time of the sale, \"as-is\" fields show today's value.",
        source: "v_dw_sales",
        kind: "view",
        hasDate: true,
        statusToggle: true,
        dimensions: {
            year:           { label: "Year",                     expr: "cal_year",          order: "cal_year",    time: true },
            quarter:        { label: "Quarter",                  expr: "cal_quarter",       order: "cal_quarter", time: true },
            month:          { label: "Month",                    expr: "month_key",         order: "month_key",   time: true },
            weekday:        { label: "Weekday",                  expr: "day_name",          order: "weekday_no",  time: true },
            customer:       { label: "Customer",                 expr: "customer_name" },
            city:           { label: "City (as-was)",            expr: "customer_city" },
            city_now:       { label: "City (as-is today)",       expr: "customer_city_now" },
            product:        { label: "Product",                  expr: "product_name" },
            category:       { label: "Category (as-was)",        expr: "category" },
            category_now:   { label: "Category (as-is today)",   expr: "category_now" },
            order_status:   { label: "Order status",             expr: "order_status" },
            payment_status: { label: "Payment status",           expr: "payment_status" }
        },
        measures: {
            revenue:         { label: "Revenue",             format: "currency", expr: "SUM(line_amount)" },
            units:           { label: "Units sold",          format: "number",   expr: "SUM(quantity)" },
            orders:          { label: "Orders",              format: "number",   expr: "COUNT(DISTINCT order_id)" },
            customers:       { label: "Customers",           format: "number",   expr: "COUNT(DISTINCT customer_id)" },
            avg_order_value: { label: "Average order value", format: "currency", expr: "SUM(line_amount) / NULLIF(COUNT(DISTINCT order_id), 0)" },
            avg_unit_price:  { label: "Average unit price",  format: "currency", expr: "AVG(unit_price)" },
            lines:           { label: "Order lines",         format: "number",   expr: "COUNT(*)" }
        }
    },

    monthly: {
        label: "Monthly sales (materialized view)",
        description: "Pre-calculated by mv_sales_monthly - completed orders only. Very fast.",
        source: "mv_sales_monthly",
        kind: "materialized view",
        dimensions: {
            month: { label: "Month", expr: "month_key",        order: "month_key", time: true },
            year:  { label: "Year",  expr: "LEFT(month_key, 4)", order: "LEFT(month_key, 4)", time: true }
        },
        measures: {
            revenue:         { label: "Revenue",             format: "currency", expr: "SUM(revenue)" },
            orders:          { label: "Orders",              format: "number",   expr: "SUM(orders_count)" },
            units:           { label: "Units sold",          format: "number",   expr: "SUM(units_sold)" },
            avg_order_value: { label: "Average order value", format: "currency", expr: "SUM(revenue) / NULLIF(SUM(orders_count), 0)" }
        }
    },

    products: {
        label: "Product sales (materialized view)",
        description: "Pre-calculated by mv_product_sales - completed orders only; category is the one valid at the time of sale.",
        source: "mv_product_sales",
        kind: "materialized view",
        dimensions: {
            product:  { label: "Product",             expr: "product_name" },
            category: { label: "Category (as-was)",   expr: "category" }
        },
        measures: {
            revenue:        { label: "Revenue",            format: "currency", expr: "SUM(revenue)" },
            units:          { label: "Units sold",         format: "number",   expr: "SUM(units_sold)" },
            orders:         { label: "Orders",             format: "number",   expr: "SUM(orders_count)" },
            avg_unit_price: { label: "Average unit price", format: "currency", expr: "SUM(revenue) / NULLIF(SUM(units_sold), 0)" }
        }
    },

    cities: {
        label: "City sales (materialized view)",
        description: "Pre-calculated by mv_city_sales - completed orders only; the city is where the customer lived at the time of sale.",
        source: "mv_city_sales",
        kind: "materialized view",
        dimensions: {
            city: { label: "City (as-was)", expr: "city" }
        },
        measures: {
            revenue:         { label: "Revenue",             format: "currency", expr: "SUM(revenue)" },
            orders:          { label: "Orders",              format: "number",   expr: "SUM(orders_count)" },
            avg_order_value: { label: "Average order value", format: "currency", expr: "SUM(revenue) / NULLIF(SUM(orders_count), 0)" }
        }
    }
};

/* ---------------------------------------------------------
   what the browser is allowed to know about the data sources
   --------------------------------------------------------- */
function publicDatasets() {
    return Object.entries(DATASETS).map(([id, d]) => ({
        id,
        label: d.label,
        description: d.description,
        source: d.source,
        kind: d.kind,
        has_date: !!d.hasDate,
        has_status_toggle: !!d.statusToggle,
        dimensions: Object.entries(d.dimensions).map(([key, v]) => ({ id: key, label: v.label, time: !!v.time })),
        measures: Object.entries(d.measures).map(([key, v]) => ({ id: key, label: v.label, format: v.format }))
    }));
}

/* ---------------------------------------------------------
   Check a widget description and return a clean copy.
   Anything unknown is rejected - never passed to SQL.
   --------------------------------------------------------- */
function validateConfig(raw) {

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new HttpError(400, "Widget settings are missing.");
    }

    const dataset = DATASETS[raw.dataset];
    if (!dataset) throw new HttpError(400, "Unknown data source.");

    if (!CHARTS.includes(raw.chart)) throw new HttpError(400, "Unknown chart type.");
    const chart = raw.chart;

    let dimension = null;
    if (chart !== "kpi") {
        if (typeof raw.dimension !== "string" || !dataset.dimensions[raw.dimension]) {
            throw new HttpError(400, "Choose a valid field to group by.");
        }
        dimension = raw.dimension;
    }

    let measures = Array.isArray(raw.measures) ? raw.measures : [raw.measure];
    measures = [...new Set(measures)];
    if (!measures.length || measures.some(m => typeof m !== "string" || !dataset.measures[m])) {
        throw new HttpError(400, "Choose a valid measure.");
    }
    measures = chart === "table" ? measures.slice(0, 4) : measures.slice(0, 1);

    const filters = [];
    if (raw.filters !== undefined && raw.filters !== null) {
        if (!Array.isArray(raw.filters) || raw.filters.length > 3) {
            throw new HttpError(400, "At most 3 filters are allowed.");
        }
        for (const f of raw.filters) {
            if (!f || typeof f.dimension !== "string" || !dataset.dimensions[f.dimension] ||
                typeof f.value !== "string" || !f.value.length || f.value.length > 100) {
                throw new HttpError(400, "A filter is not valid.");
            }
            filters.push({ dimension: f.dimension, value: f.value });
        }
    }

    const config = {
        dataset: raw.dataset,
        chart,
        dimension,
        measures,
        filters,
        limit: raw.limit === undefined || raw.limit === null || raw.limit === ""
            ? 10 : requireInt(raw.limit, "Limit", 1),
        sort: ["auto", "asc", "desc"].includes(raw.sort) ? raw.sort : "auto"
    };

    if (config.limit > 60) throw new HttpError(400, "Limit must be between 1 and 60.");

    if (dataset.statusToggle) config.completed_only = raw.completed_only !== false;

    if (dataset.hasDate) {
        if (raw.date_from) config.date_from = requireDate(raw.date_from, "From date");
        if (raw.date_to)   config.date_to   = requireDate(raw.date_to, "To date");
    }

    return config;
}

/* ---------------------------------------------------------
   config -> one SELECT
   --------------------------------------------------------- */
function buildQuery(config, userId) {

    const dataset = DATASETS[config.dataset];
    const dim = config.dimension ? dataset.dimensions[config.dimension] : null;
    const measureList = config.measures.map(id => dataset.measures[id]);

    const select = [];
    if (dim) select.push(`${dim.expr} AS dimension`);
    measureList.forEach((m, i) => select.push(`${m.expr} AS m${i + 1}`));

    const where = ["user_id = ?"];
    const params = [userId];

    if (dataset.statusToggle && config.completed_only) where.push("order_status = 'COMPLETED'");
    if (config.date_from) { where.push("order_date >= ?"); params.push(config.date_from); }
    if (config.date_to)   { where.push("order_date <= ?"); params.push(config.date_to); }
    for (const f of config.filters) {
        where.push(`${dataset.dimensions[f.dimension].expr} = ?`);
        params.push(f.value);
    }

    let sql = `SELECT ${select.join(", ")}\n  FROM ${dataset.source}\n WHERE ${where.join("\n   AND ")}`;

    let reverseAfter = false;

    if (dim) {
        const groupBy = [dim.expr];
        if (dim.order && dim.order !== dim.expr) groupBy.push(dim.order);
        sql += `\n GROUP BY ${groupBy.join(", ")}`;

        if (config.sort === "auto" && dim.time) {
            // time series: newest N periods, then shown oldest -> newest
            sql += `\n ORDER BY ${dim.order || dim.expr} DESC`;
            reverseAfter = true;
        } else {
            sql += `\n ORDER BY m1 ${config.sort === "asc" ? "ASC" : "DESC"}`;
        }
        sql += "\n LIMIT ?";
        params.push(config.limit);
    }

    return { sql, params, reverseAfter };
}

async function runQuery(userId, rawConfig) {

    const config = validateConfig(rawConfig);
    const dataset = DATASETS[config.dataset];
    const { sql, params, reverseAfter } = buildQuery(config, userId);

    const started = process.hrtime.bigint();
    const [rows] = await pool.query(sql, params);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    const columns = [];
    if (config.dimension) {
        columns.push({ id: "dimension", label: dataset.dimensions[config.dimension].label, format: "text" });
    }
    config.measures.forEach(id => {
        columns.push({ id, label: dataset.measures[id].label, format: dataset.measures[id].format });
    });

    let table = rows.map(row => {
        const out = [];
        if (config.dimension) out.push(row.dimension === null ? "(none)" : String(row.dimension));
        config.measures.forEach((_, i) => {
            const v = row[`m${i + 1}`];
            out.push(v === null || v === undefined ? null : Number(v));
        });
        return out;
    });
    if (reverseAfter) table = table.reverse();

    return {
        config,
        columns,
        rows: table,
        source: dataset.source,
        source_kind: dataset.kind,
        elapsed_ms: Math.round(elapsedMs * 100) / 100,
        sql: mysqlFormat(sql, params)          // shown to the user; the real query used ? parameters
    };
}

/* ---------------------------------------------------------
   ONE-CLICK DASHBOARD TEMPLATES
   --------------------------------------------------------- */
const kpi = (title, measure, dataset = "sales") =>
    ({ title, size: "S", config: { dataset, chart: "kpi", measures: [measure] } });

const chart = (title, chartType, dataset, dimension, measure, limit = 8, extra = {}) =>
    ({ title, size: "M", config: { dataset, chart: chartType, dimension, measures: [measure], limit, ...extra } });

const table = (title, dataset, dimension, measures, limit = 15) =>
    ({ title, size: "L", config: { dataset, chart: "table", dimension, measures, limit } });

const TEMPLATES = [
    {
        id: "executive",
        name: "Executive overview",
        description: "Headline numbers, monthly trend, categories, best products and cities.",
        widgets: [
            kpi("Revenue", "revenue"), kpi("Orders", "orders"),
            kpi("Average order value", "avg_order_value"), kpi("Active customers", "customers"),
            chart("Revenue by month", "line", "monthly", "month", "revenue", 24),
            chart("Revenue by category", "doughnut", "sales", "category", "revenue", 8),
            chart("Top 8 products by revenue", "bar", "products", "product", "revenue", 8),
            chart("Revenue by city", "bar", "cities", "city", "revenue", 8)
        ]
    },
    {
        id: "products",
        name: "Product performance",
        description: "Which products and categories earn the most.",
        widgets: [
            kpi("Units sold", "units"), kpi("Revenue", "revenue"),
            kpi("Average unit price", "avg_unit_price"), kpi("Order lines", "lines"),
            chart("Top 10 products by revenue", "bar", "products", "product", "revenue", 10),
            chart("Top 10 products by units", "bar", "products", "product", "units", 10),
            chart("Revenue by category", "doughnut", "products", "category", "revenue", 8),
            chart("Revenue by category (as it was)", "bar", "sales", "category", "revenue", 8),
            table("Product table", "products", "product", ["revenue", "units", "orders", "avg_unit_price"], 20)
        ]
    },
    {
        id: "customers",
        name: "Customer analytics",
        description: "Best customers, cities and the health of the order pipeline.",
        widgets: [
            kpi("Active customers", "customers"), kpi("Orders", "orders"),
            kpi("Average order value", "avg_order_value"), kpi("Revenue", "revenue"),
            chart("Top 10 customers by revenue", "bar", "sales", "customer", "revenue", 10),
            chart("Orders by status (all orders)", "pie", "sales", "order_status", "orders", 6, { completed_only: false }),
            chart("Revenue by city", "bar", "cities", "city", "revenue", 10),
            chart("Payments by status (all orders)", "doughnut", "sales", "payment_status", "revenue", 6, { completed_only: false }),
            table("Customer table", "sales", "customer", ["revenue", "orders", "avg_order_value"], 20)
        ]
    },
    {
        id: "history",
        name: "History-aware (SCD Type 2)",
        description: "The same revenue split by the value AT THE TIME of the sale versus TODAY's value.",
        widgets: [
            chart("Revenue by city - as it was", "bar", "sales", "city", "revenue", 10),
            chart("Revenue by city - as it is today", "bar", "sales", "city_now", "revenue", 10),
            chart("Revenue by category - as it was", "bar", "sales", "category", "revenue", 8),
            chart("Revenue by category - as it is today", "bar", "sales", "category_now", "revenue", 8),
            table("Average unit price by product (changes when the price changed)", "sales", "product", ["avg_unit_price", "units", "revenue"], 15)
        ]
    },
    {
        id: "calendar",
        name: "Sales calendar",
        description: "When do we sell: month, quarter and weekday patterns.",
        widgets: [
            chart("Revenue by month", "line", "sales", "month", "revenue", 24),
            chart("Orders by month", "bar", "sales", "month", "orders", 24),
            chart("Revenue by quarter", "bar", "sales", "quarter", "revenue", 12),
            chart("Revenue by weekday", "bar", "sales", "weekday", "revenue", 7)
        ]
    }
];

// a broken template must fail when the server starts, not when a user clicks it
for (const template of TEMPLATES) {
    for (const widget of template.widgets) {
        try { validateConfig(widget.config); }
        catch (error) { throw new Error(`Template "${template.id}" / "${widget.title}": ${error.message}`); }
    }
}

module.exports = { DATASETS, TEMPLATES, CHARTS, publicDatasets, validateConfig, buildQuery, runQuery };
