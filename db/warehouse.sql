-- =====================================================================
-- ELECZZ Software - DATA WAREHOUSE tables      (db/warehouse.sql)
--
-- Created automatically by  npm run setup-db.  Safe to run again.
-- In MySQL Workbench first double-click the 'eleczz' schema, then run.
--
--   STAR SCHEMA        dw_dim_date, dw_dim_customer, dw_dim_product, dw_fact_sales
--   SCD TYPE 2         dw_dim_customer (city), dw_dim_product (category, price)
--   PARTITIONING       dw_fact_sales  (RANGE by date, one partition per quarter)
--   "MATERIALIZED"     mv_sales_monthly, mv_product_sales, mv_city_sales, mv_status
--   ETL LOG            etl_run_log
--   BI DASHBOARDS      bi_dashboards, bi_widgets
--
-- The routines that fill these tables are in db/routines.sql.
-- =====================================================================

USE eleczz;

-- ---------------------------------------------------------------------
-- ETL run log: one row per warehouse load
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS etl_run_log (
    run_id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    user_id            INT UNSIGNED  NOT NULL,
    as_of_date         DATE          NOT NULL,
    started_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at        DATETIME      NULL,
    status             ENUM('RUNNING','SUCCESS','FAILED') NOT NULL DEFAULT 'RUNNING',
    customers_new      INT UNSIGNED  NOT NULL DEFAULT 0,
    customers_changed  INT UNSIGNED  NOT NULL DEFAULT 0,
    products_new       INT UNSIGNED  NOT NULL DEFAULT 0,
    products_changed   INT UNSIGNED  NOT NULL DEFAULT 0,
    facts_inserted     INT UNSIGNED  NOT NULL DEFAULT 0,
    facts_updated      INT UNSIGNED  NOT NULL DEFAULT 0,
    facts_remapped     INT UNSIGNED  NOT NULL DEFAULT 0,
    message            VARCHAR(255)  NULL,
    PRIMARY KEY (run_id),
    KEY idx_etl_user (user_id, run_id),
    CONSTRAINT fk_etl_user
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- DATE DIMENSION  (one row per calendar day)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dw_dim_date (
    date_key      INT          NOT NULL,            -- 20260920
    full_date     DATE         NOT NULL,
    cal_year      SMALLINT     NOT NULL,
    cal_quarter   TINYINT      NOT NULL,
    cal_month     TINYINT      NOT NULL,
    month_name    VARCHAR(12)  NOT NULL,
    month_key     CHAR(7)      NOT NULL,            -- '2026-09'
    day_of_month  TINYINT      NOT NULL,
    day_of_week   TINYINT      NOT NULL,            -- 1 = Sunday
    day_name      VARCHAR(12)  NOT NULL,
    is_weekend    TINYINT(1)   NOT NULL,
    iso_week      TINYINT      NOT NULL,
    PRIMARY KEY (date_key),
    UNIQUE KEY uq_dim_date_full (full_date),
    KEY idx_dim_date_month (month_key)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- CUSTOMER DIMENSION  -  Slowly Changing Dimension
--   city                     : Type 2  (a change creates a NEW row, history kept)
--   name / email / signup    : Type 1  (a change overwrites, no history)
--   customer_sk              : surrogate key the fact table points at
--   effective_from / _to     : the period this version was true
--   is_current               : 1 for the newest version
--   The first version of every customer starts at 1900-01-01 so an order can
--   never fall outside every version.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dw_dim_customer (
    customer_sk     INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    user_id         INT UNSIGNED  NOT NULL,
    customer_id     INT UNSIGNED  NOT NULL,          -- business (natural) key
    name            VARCHAR(120)  NOT NULL,
    email           VARCHAR(190)  NOT NULL,
    city            VARCHAR(100)  NOT NULL,
    signup_date     DATE          NOT NULL,
    effective_from  DATE          NOT NULL,
    effective_to    DATE          NOT NULL DEFAULT '9999-12-31',
    is_current      TINYINT(1)    NOT NULL DEFAULT 1,
    version_no      INT UNSIGNED  NOT NULL DEFAULT 1,
    created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (customer_sk),
    UNIQUE KEY uq_dimcust_version (customer_id, version_no),
    KEY idx_dimcust_lookup (user_id, customer_id, is_current),
    CONSTRAINT ck_dimcust_dates CHECK (effective_to >= effective_from),
    CONSTRAINT fk_dimcust_user
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- PRODUCT DIMENSION  -  Slowly Changing Dimension
--   category, list_price     : Type 2
--   product_name             : Type 1
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dw_dim_product (
    product_sk      INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    user_id         INT UNSIGNED  NOT NULL,
    product_id      INT UNSIGNED  NOT NULL,
    product_name    VARCHAR(160)  NOT NULL,
    category        VARCHAR(100)  NOT NULL,
    list_price      DECIMAL(12,2) NOT NULL,
    effective_from  DATE          NOT NULL,
    effective_to    DATE          NOT NULL DEFAULT '9999-12-31',
    is_current      TINYINT(1)    NOT NULL DEFAULT 1,
    version_no      INT UNSIGNED  NOT NULL DEFAULT 1,
    created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (product_sk),
    UNIQUE KEY uq_dimprod_version (product_id, version_no),
    KEY idx_dimprod_lookup (user_id, product_id, is_current),
    CONSTRAINT ck_dimprod_dates CHECK (effective_to >= effective_from),
    CONSTRAINT fk_dimprod_user
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- SALES FACT TABLE  -  one row per order line, PARTITIONED BY QUARTER
--
--   Why partition here?  MySQL cannot partition a table that has FOREIGN
--   KEYS, and the live 'orders' table needs them.  The warehouse fact table
--   has none, so this is where partitioning belongs (and where the big,
--   append-only data lives in a real warehouse).
--
--   Every UNIQUE key of a partitioned table must contain the partition
--   column, so the primary key is (order_item_id, date_key).
--   New quarters are added automatically by sp_dw_ensure_partitions().
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dw_fact_sales (
    order_item_id   INT UNSIGNED  NOT NULL,
    date_key        INT           NOT NULL,          -- partition column
    user_id         INT UNSIGNED  NOT NULL,
    order_id        INT UNSIGNED  NOT NULL,
    customer_id     INT UNSIGNED  NOT NULL,
    product_id      INT UNSIGNED  NOT NULL,
    customer_sk     INT UNSIGNED  NOT NULL,          -- version valid on the order date
    product_sk      INT UNSIGNED  NOT NULL,
    order_status    ENUM('PENDING','PROCESSING','COMPLETED','CANCELLED') NOT NULL,
    payment_status  ENUM('PENDING','PAID','REFUNDED') NULL,
    quantity        INT UNSIGNED  NOT NULL,
    unit_price      DECIMAL(12,2) NOT NULL,
    line_amount     DECIMAL(14,2) NOT NULL,
    loaded_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (order_item_id, date_key),
    KEY idx_fact_user_date (user_id, date_key),
    KEY idx_fact_order (order_id),
    KEY idx_fact_customer_sk (customer_sk),
    KEY idx_fact_product_sk (product_sk),
    CONSTRAINT ck_fact_amounts CHECK (quantity > 0 AND unit_price >= 0 AND line_amount >= 0)
) ENGINE=InnoDB
PARTITION BY RANGE (date_key) (
    PARTITION p_history VALUES LESS THAN (20250101),
    PARTITION p2025_q1  VALUES LESS THAN (20250401),
    PARTITION p2025_q2  VALUES LESS THAN (20250701),
    PARTITION p2025_q3  VALUES LESS THAN (20251001),
    PARTITION p2025_q4  VALUES LESS THAN (20260101),
    PARTITION p2026_q1  VALUES LESS THAN (20260401),
    PARTITION p2026_q2  VALUES LESS THAN (20260701),
    PARTITION p2026_q3  VALUES LESS THAN (20261001),
    PARTITION p2026_q4  VALUES LESS THAN (20270101),
    PARTITION p_future  VALUES LESS THAN MAXVALUE
);

-- ---------------------------------------------------------------------
-- "MATERIALIZED VIEWS"
--   MySQL has no native materialized views. The standard technique is used
--   instead: a real table holding the pre-computed result of a query, plus
--   a procedure (sp_refresh_mv) that rebuilds it. mv_status records when
--   each one was last refreshed so the website can show how fresh it is.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mv_sales_monthly (
    user_id          INT UNSIGNED  NOT NULL,
    month_key        CHAR(7)       NOT NULL,
    orders_count     INT UNSIGNED  NOT NULL,
    units_sold       INT UNSIGNED  NOT NULL,
    revenue          DECIMAL(16,2) NOT NULL,
    avg_order_value  DECIMAL(14,2) NOT NULL,
    customers        INT UNSIGNED  NOT NULL,
    refreshed_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, month_key),
    CONSTRAINT fk_mvmonthly_user
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS mv_product_sales (
    user_id       INT UNSIGNED  NOT NULL,
    product_id    INT UNSIGNED  NOT NULL,
    category      VARCHAR(100)  NOT NULL,           -- category AT THE TIME OF SALE
    product_name  VARCHAR(160)  NOT NULL,
    units_sold    INT UNSIGNED  NOT NULL,
    revenue       DECIMAL(16,2) NOT NULL,
    orders_count  INT UNSIGNED  NOT NULL,
    refreshed_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, product_id, category),
    CONSTRAINT fk_mvproduct_user
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS mv_city_sales (
    user_id       INT UNSIGNED  NOT NULL,
    city          VARCHAR(100)  NOT NULL,           -- city AT THE TIME OF SALE
    orders_count  INT UNSIGNED  NOT NULL,
    customers     INT UNSIGNED  NOT NULL,
    revenue       DECIMAL(16,2) NOT NULL,
    refreshed_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, city),
    CONSTRAINT fk_mvcity_user
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS mv_status (
    user_id       INT UNSIGNED  NOT NULL,
    mv_name       VARCHAR(40)   NOT NULL,
    refreshed_at  DATETIME      NOT NULL,
    row_count     INT UNSIGNED  NOT NULL,
    PRIMARY KEY (user_id, mv_name),
    CONSTRAINT fk_mvstatus_user
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- BI DASHBOARDS saved by the Dashboard Builder page
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bi_dashboards (
    dashboard_id  INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    user_id       INT UNSIGNED  NOT NULL,
    name          VARCHAR(80)   NOT NULL,
    template      VARCHAR(40)   NULL,
    created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (dashboard_id),
    KEY idx_bi_dash_user (user_id),
    CONSTRAINT fk_bi_dash_user
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bi_widgets (
    widget_id     INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    dashboard_id  INT UNSIGNED  NOT NULL,
    position      INT UNSIGNED  NOT NULL,
    title         VARCHAR(100)  NOT NULL,
    size          ENUM('S','M','L') NOT NULL DEFAULT 'M',
    config        JSON          NOT NULL,
    PRIMARY KEY (widget_id),
    KEY idx_bi_widget_dash (dashboard_id, position),
    CONSTRAINT fk_bi_widget_dash
        FOREIGN KEY (dashboard_id) REFERENCES bi_dashboards (dashboard_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- v_dw_sales : the flat, analyst-friendly view of the whole star schema.
--   The Dashboard Builder and any BI tool read from this one view.
--   customer_city / category        = value AT THE TIME OF THE SALE (SCD)
--   customer_city_now / category_now = value TODAY
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_dw_sales AS
SELECT  f.user_id,
        f.order_item_id,
        f.order_id,
        f.customer_id,
        f.product_id,
        d.full_date      AS order_date,
        d.cal_year,
        CONCAT(d.cal_year, '-Q', d.cal_quarter) AS cal_quarter,
        d.month_key,
        d.day_name,
        d.day_of_week    AS weekday_no,
        d.is_weekend,
        dc.name          AS customer_name,
        dc.city          AS customer_city,
        cur_c.city       AS customer_city_now,
        dp.product_name,
        dp.category      AS category,
        cur_p.category   AS category_now,
        dp.list_price,
        f.order_status,
        f.payment_status,
        f.quantity,
        f.unit_price,
        f.line_amount
FROM    dw_fact_sales    f
JOIN    dw_dim_date      d      ON d.date_key      = f.date_key
JOIN    dw_dim_customer  dc     ON dc.customer_sk  = f.customer_sk
JOIN    dw_dim_product   dp     ON dp.product_sk   = f.product_sk
LEFT JOIN dw_dim_customer cur_c ON cur_c.customer_id = f.customer_id AND cur_c.is_current = 1
LEFT JOIN dw_dim_product  cur_p ON cur_p.product_id  = f.product_id  AND cur_p.is_current = 1;
