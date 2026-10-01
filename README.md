# ELECZZ Software – Sales & Order Management Analytics System

A full-stack business application **and** a complete SQL analytics project:

* **MySQL 8** database with 7 normalized tables, constraints, indexes, views, triggers and stored procedures
* A **data warehouse** alongside it: star schema, Slowly Changing Dimensions (Type 2), a partitioned
  fact table, materialized views, and an ETL procedure that loads it from the live tables
* **Node.js / Express** API (parameterised SQL, transactions, bcrypt logins, validation)
* **Web app** (HTML / CSS / JavaScript) – customers, products, orders, payments, an executive
  dashboard, **SQL Reports**, a **Data Warehouse** page, and a self-hosted **BI Dashboards** builder
* **9 SQL practice files** covering CRUD, joins, aggregation, subqueries, CTEs, window functions, views,
  indexing / `EXPLAIN` and transactions – all runnable on ready-made demo data

```
Browser (public/)  ──fetch /api──▶  Node.js + Express (server.js)  ──mysql2──▶  MySQL "eleczz"
                                                                                  ├─ 7 OLTP tables
                                                                                  ├─ 6 reporting views
                                                                                  ├─ star schema (4 tables, SCD Type 2)
                                                                                  ├─ dw_fact_sales — PARTITIONED
                                                                                  ├─ 3 materialized views
                                                                                  ├─ 2 triggers, 9 stored procedures, 6 functions
                                                                                  └─ 1 ETL procedure, 1 nightly event (disabled)
```

Everything runs on **your own machine / server**. Nothing is sent to any third-party service
(the only external file the browser loads is the Chart.js library from a CDN).

---

## 1. Requirements

* **Node.js 18+** – https://nodejs.org
* **MySQL 8.0.18 or newer** (window functions, CTEs, `CHECK` constraints and `EXPLAIN ANALYZE` need MySQL 8;
  MySQL 5.7 is **not** supported). `npm run setup-db` stops with a clear message on an older server.

## 2. Quick start

```bash
npm install                       # 1) libraries

copy .env.example .env            # 2) settings   (macOS/Linux: cp .env.example .env)
                                  #    edit .env: DB_PASSWORD and JWT_SECRET
                                  #    make a secret:
                                  #    node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

npm run setup-db                  # 3) tables + views + triggers + procedures (safe to repeat)
npm run seed                      # 4) demo data: 30 customers, 27 products, 220 orders (optional)
npm start                         # 5) open  http://localhost:3000
```

> Always open **http://localhost:3000** – never double-click `index.html`.

**Demo login** (created by `npm run seed`): `demo@eleczz.com` / `Demo@123`

Or sign up with your own account – it starts empty, and each account only sees its own data.

### Already have the first version of the project?

Just run `npm run setup-db` again. It upgrades your existing database **in place and keeps your data**:
it adds the CHECK constraints, the unique-email rule and the new indexes, creates the views, triggers and
procedures, and back-fills the audit history. If two of your customers share an email address it tells you
which rule could not be added – fix the duplicate and run it again.

---

## 3. Project structure

```
eleczz/
├── server.js                  Express app: API + serves /public
├── db.js                      MySQL connection pool
├── routes/                    auth, data, customers, products, orders, analytics, warehouse, bi
├── utils/                     input validation, analytics queries, the BI query-builder engine
├── middleware/auth.js         httpOnly login cookie (JWT)
├── scripts/                   setup-db (init-db.js + upgrades.js) and seed.js
├── db/
│   ├── schema.sql             CREATE TABLE statements, constraints, indexes (live OLTP tables)
│   ├── warehouse.sql          star schema: dimensions (SCD Type 2), partitioned fact table, materialized views
│   ├── routines.sql           functions, ETL procedures, the nightly refresh event
│   ├── seed.sql                INSERT statements for the demo data
│   └── seed_history.sql       scripted historical changes, so the demo has real SCD version history
├── sql/                       the SQL project files – see section 4
├── docs/                      business requirements, ER diagram, BI-tool guide
└── public/                    the frontend (index.html, script.js, style.css)
```

## 4. The SQL files (`sql/`)

Run them in **MySQL Workbench**: *File → Open SQL Script*, double-click the **eleczz** schema so it turns bold,
then press the ⚡ *Execute* button (results appear in tabs). Or from a terminal:
`mysql -u root -p eleczz < sql/03_aggregations.sql`. Load the demo data first (`npm run seed`).

| File | Topic | What you will find |
|---|---|---|
| `01_crud_operations.sql` | CRUD | INSERT (single / multi-row), SELECT, UPDATE, DELETE – wrapped in a transaction that **rolls back**, so it never changes your data |
| `02_joins.sql` | Joins | INNER, LEFT (customers with no orders, products never sold), 5-table join, self join, data-quality joins |
| `03_aggregations.sql` | Aggregation | SUM / COUNT / AVG / MIN / MAX, GROUP BY, HAVING, WITH ROLLUP, revenue by month (the brief's example), top 10 products, cancellation rate |
| `04_advanced_sql.sql` | Advanced SQL | Subqueries, CTEs (incl. recursive), CASE, RANK / DENSE_RANK / ROW_NUMBER, running total, month-over-month (`LAG`), moving average, NTILE, RFM segmentation, cohorts, win-back list |
| `05_views.sql` | Views | 6 reusable reporting views (created automatically by `setup-db`) |
| `06_view_reports.sql` | Reports | Ready-made business reports built on the views |
| `07_routines_triggers.sql` | Triggers / procedures | Audit-trail triggers, `sp_sales_summary`, `sp_top_products` |
| `08_query_optimization.sql` | Performance | Builds 250,000 rows, then `EXPLAIN` / `EXPLAIN ANALYZE` before and after adding indexes |
| `09_transactions.sql` | Transactions | The order-placing steps with COMMIT, then a mistake undone with ROLLBACK, with before/after proof |

### Measured index effect (`08_query_optimization.sql`, 250,000 rows, one test machine)

| Step | Plan | Rows read | Time |
|---|---|---|---|
| No index | `type = ALL` (full table scan) | ~250,000 | ~65 ms |
| Composite index `(user_id, status, order_date)` | `type = range` | ~1,000 | ~3 ms |
| Covering index (+ `total_amount`) | `Using index` | ~1,000 | ~1 ms |

Your timings will differ; the *pattern* is what matters.

### The SQL Reports page

The **SQL Reports** page in the app – and the dashboard's headline numbers, charts, top products and top
customers – are calculated by MySQL views. **No revenue maths happens in the browser.** The same JSON is available
at `GET /api/analytics`.

---

## 5. Database summary

| Table | Holds |
|---|---|
| `users` | accounts (bcrypt password hash) |
| `customers` | customer, unique email per account |
| `products` | product, price (CHECK ≥ 0), stock |
| `orders` | order header, status, total (numbering starts at 1001) |
| `order_items` | product, quantity, price at the time of order |
| `payments` | one payment per order |
| `order_status_history` | audit log written by triggers |

Diagram and normalization notes: [`docs/ER_DIAGRAM.md`](docs/ER_DIAGRAM.md).
Business rules and questions: [`docs/BUSINESS_REQUIREMENTS.md`](docs/BUSINESS_REQUIREMENTS.md).

**Reporting views:** `v_dashboard_kpis`, `v_monthly_revenue`, `v_product_performance`, `v_customer_performance`,
`v_order_status_summary`, `v_order_details`.

## 5a. The data warehouse (star schema, SCD, partitioning, materialized views)

`db/warehouse.sql` adds a second, analytics-only schema alongside the live tables. It is filled by
an ETL procedure (`db/routines.sql`) rather than written to directly by the app.

| Table | Role |
|---|---|
| `dw_dim_date` | one row per calendar day |
| `dw_dim_customer` | **SCD Type 2** on city; Type 1 (overwrite) on name/email |
| `dw_dim_product` | **SCD Type 2** on category and price; Type 1 on the product name |
| `dw_fact_sales` | one row per order line, **`PARTITION BY RANGE` on quarter** |
| `mv_sales_monthly`, `mv_product_sales`, `mv_city_sales` | **materialized views** (real tables + a refresh procedure, since MySQL has no native materialized view syntax) |
| `etl_run_log` | history of every warehouse load |
| `bi_dashboards`, `bi_widgets` | dashboards saved from the BI Dashboards page |

**Why partitioning lives here and not on `orders`:** MySQL cannot partition a table that has foreign
keys, and the live `orders` table needs them for data integrity. `dw_fact_sales` has none, so this is
where the brief's "partitioning for large order tables" belongs — and where the big, append-only data
sits in a real warehouse anyway. Proof it actually prunes:

```sql
EXPLAIN SELECT SUM(line_amount) FROM dw_fact_sales WHERE date_key BETWEEN 20260401 AND 20260630;
-- partitions: p2026_q2        (1 of 10 — the other 9 are never read)
```

**How the ETL works:** `CALL sp_etl_run(user_id, CURRENT_DATE)` compares the live tables to the
dimensions, closes a customer/product's old version the day before a tracked field (city / category /
price) changed, opens a new "current" version, loads any new order lines, and rebuilds the
materialized views — all inside one transaction. Run it from the **Data Warehouse** page ("Run ETL
Now"), or on a schedule (see below).

**Nightly refresh:** a MySQL `EVENT` (`ev_nightly_warehouse_refresh`) is created **disabled**, so
nothing runs on its own. Turn it on with:
```sql
ALTER EVENT ev_nightly_warehouse_refresh ENABLE;
```

## 5b. BI Dashboards (works without a Power BI or Microsoft account)

The **BI Dashboards** page is a small dashboard builder built into the app itself:

* **5 one-click templates** (Executive overview, Product performance, Customer analytics,
  History-aware SCD comparison, Sales calendar) that generate a full dashboard of KPI cards and
  charts in one click.
* **Build your own**: pick a data source, a chart type, a field to group by and a measure; the
  server turns that into one parameterised SQL query (every table/column name is checked against a
  whitelist first — the browser never sends SQL).
* **CSV export**, per widget or for the whole dashboard, that opens directly in Power BI Desktop,
  Excel, or Google Sheets.
* Dashboards are saved per account (`bi_dashboards` / `bi_widgets`), so they are still there next
  time you log in.

A real, hand-authored `.pbix` file is **not** included: that binary format can only reliably be
produced and checked from inside Power BI Desktop itself, which this environment does not have. See
[`docs/BI_TOOLS.md`](docs/BI_TOOLS.md) for connecting an actual Power BI Desktop install, if you have
one, straight to the six reporting views over MySQL.

## 6. Project brief checklist

| Brief requirement | Status | Where |
|---|---|---|
| Business requirements | Done | `docs/BUSINESS_REQUIREMENTS.md` |
| ER / data model | Done | `docs/ER_DIAGRAM.md`, `er-diagram.png` |
| 5 required tables and columns | Done | `db/schema.sql` |
| PK, FK, NOT NULL, UNIQUE, CHECK | Done | `db/schema.sql` |
| Sample data with INSERT statements | Done | `db/seed.sql` |
| CRUD | Done | `sql/01_…`, and the web app |
| INNER / LEFT / multi-table joins | Done | `sql/02_…` |
| SUM, COUNT, AVG, MIN, MAX, GROUP BY, HAVING | Done | `sql/03_…` |
| Subqueries, CTEs, CASE | Done | `sql/04_…` sections A, B, C |
| Window functions, ranking, running totals, month-over-month | Done | `sql/04_…` section D |
| Customer segmentation, repeat purchases | Done | `sql/04_…` section E, `v_customer_performance` |
| Views | Done | `sql/05_…`, `sql/06_…` |
| Indexes, EXPLAIN, optimization | Done | `db/schema.sql`, `sql/08_…` |
| Transactions | Done | `sql/09_…`, `routes/orders.js` |
| Stored procedures | Done | `sql/07_…` |
| Triggers for audit / history | Done | `sql/07_…`, table `order_status_history` |
| Power BI / Tableau connected to SQL | Self-hosted equivalent | The **BI Dashboards** page: 5 one-click templates, a build-your-own widget editor, live Chart.js charts, and CSV export that opens directly in Power BI Desktop, Excel, or Google Sheets. No literal `.pbix` file is included &mdash; see `docs/BI_TOOLS.md` for why, and how to connect a real Power BI Desktop install if you have one. |
| Materialized views | Done | Real tables (`mv_sales_monthly`, `mv_product_sales`, `mv_city_sales`), rebuilt by `sp_refresh_mv`. Manage them from the **Data Warehouse** page. |
| Partitioning | Done, as an archive/warehouse table | `dw_fact_sales` is `PARTITION BY RANGE` on quarter (10 partitions). MySQL cannot partition a table with foreign keys, and the live `orders` table needs them, so partitioning lives in the fact table instead &mdash; exactly the "large order table" the brief describes, just in the warehouse rather than the OLTP schema. Proven with `EXPLAIN`: a one-quarter query reads 1 of 10 partitions. |
| Slowly Changing Dimensions | Done (Type 2) | `dw_dim_customer` (city) and `dw_dim_product` (category, price) keep full version history with `effective_from`/`effective_to`. Point-in-time lookups via `fn_customer_city_on()` / `fn_product_price_on()`. Browse it on the **Data Warehouse** page. |
| ETL pipeline into a warehouse | Done | `sp_etl_run` extracts from the live tables, applies the SCD rules, and loads the star schema, inside one transaction. Runs on demand (button) or nightly (disabled-by-default `EVENT`). |

## 7. API reference

Everything except `signup`, `login` and `logout` requires being logged in.

| Method | URL | What it does |
|---|---|---|
| POST | `/api/auth/signup` · `/login` · `/logout` | Account handling |
| GET | `/api/auth/me` | Who is logged in (restores the session on reload) |
| GET | `/api/data` | Customers, products, orders, items, payments **and** the SQL analytics |
| GET | `/api/analytics` | Just the SQL-view reports |
| POST / PUT / DELETE | `/api/customers[/:id]` | Add / edit / delete a customer |
| POST / PUT / DELETE | `/api/products[/:id]` | Add / edit / delete a product |
| POST | `/api/orders` | Create an order (order + item + payment + stock, one transaction) |
| PUT | `/api/orders/:id/status` | Change order status (updates the payment too) |
| GET | `/api/warehouse/overview` | ETL history, dimension versions, partitions, materialized-view freshness |
| GET | `/api/warehouse/status` | Just the freshness check (is the warehouse behind the live tables?) |
| POST | `/api/warehouse/etl` | Run the ETL now (`CALL sp_etl_run`) |
| POST | `/api/warehouse/refresh-mv` | Rebuild the materialized views only |
| GET | `/api/warehouse/dimension/:kind` | SCD version history (`kind` = `customer` or `product`) |
| GET | `/api/warehouse/scd-report` | Revenue "as it was" vs. "as it is today" |
| GET | `/api/warehouse/pruning?from=&to=` | Runs `EXPLAIN` and reports which partitions a date range reads |
| GET | `/api/bi/datasets` · `/templates` | What the dashboard builder can chart |
| POST | `/api/bi/query` | Run one widget's query (whitelisted; returns data + the SQL used) |
| GET / POST | `/api/bi/dashboards` | List / create dashboards |
| POST | `/api/bi/dashboards/generate` | Create a dashboard from a template |
| GET / PUT / DELETE | `/api/bi/dashboards/:id` | Open / save / delete one dashboard |

## 8. Security built in

* Passwords hashed with **bcrypt**; login cookie is **httpOnly + SameSite**
* All SQL uses **parameters** (`?`) – protected against SQL injection
* Server-side **validation** of every input; totals calculated by the server
* **Transactions with row locks** – two people cannot buy the last item at once
* **Rate limiting** on login / signup
* The database itself refuses bad data (CHECK, UNIQUE, FOREIGN KEY)

## 9. Going online later

**Full step-by-step guide, including a free MySQL host and a free Node.js host, with a real
shareable URL:** [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

1. Set `NODE_ENV=production` in `.env` and serve over **HTTPS** (login cookies need it).
2. Use a **dedicated MySQL user**, not `root`:
   ```sql
   CREATE USER 'eleczz_app'@'localhost' IDENTIFIED BY 'a-strong-password';
   GRANT SELECT, INSERT, UPDATE, DELETE ON eleczz.* TO 'eleczz_app'@'localhost';
   ```
   Run `npm run setup-db` once with `root` first (it creates triggers, views and procedures), then switch `.env`
   to the app user.
3. The demo account (`demo@eleczz.com` / `Demo@123`) has a **publicly known password** – do not seed it on a real server.
4. Keep the app alive with `pm2 start server.js --name eleczz` and back up with `mysqldump -u root -p eleczz > backup.sql`.

## 10. Troubleshooting

| Message | Fix |
|---|---|
| `ECONNREFUSED 127.0.0.1:3306` | MySQL is not running – start the MySQL service |
| `Access denied for user 'root'` | Wrong `DB_USER` / `DB_PASSWORD` in `.env` |
| `Unknown database` / `tables do not exist` | Run `npm run setup-db` |
| `MySQL … is too old` | Install MySQL 8.0.18 or newer |
| `JWT_SECRET is missing, too short, or still the placeholder` | Set a real 32+ character secret in `.env` |
| `EADDRINUSE :::3000` | Change `PORT` in `.env` |
| `! could not apply uq_customers_user_email` | Two customers in one account share an email – delete one, run `npm run setup-db` again |
| `No database selected` in Workbench | Double-click the `eleczz` schema so it is bold, then run the file again |
| Reports / dashboard look empty | Run `npm run seed` and log in as `demo@eleczz.com` |
