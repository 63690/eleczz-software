-- =====================================================================
-- ELECZZ Software - FUNCTIONS, PROCEDURES, ETL       (db/routines.sql)
--
-- Created automatically by  npm run setup-db.  Safe to run again.
-- In MySQL Workbench first double-click the 'eleczz' schema, then run.
--
--   FUNCTIONS    fn_date_key, fn_growth_pct, fn_customer_segment,
--                fn_order_total, fn_customer_city_on, fn_product_price_on
--   PROCEDURES   sp_create_order          place an order (transaction)
--                sp_etl_run               ETL: OLTP tables -> star schema (SCD)
--                sp_etl_run_all           the same for every account
--                sp_refresh_mv            rebuild the materialized views
--                sp_dw_load_dim_date      fill the calendar dimension
--                sp_dw_ensure_partitions  add new quarterly partitions
--                sp_dw_purge_orphans      remove facts of deleted accounts
--   EVENT        ev_nightly_warehouse_refresh   (created DISABLED)
--
-- The DELIMITER lines are needed because procedure bodies contain ';'.
-- =====================================================================

USE eleczz;

DELIMITER $$

-- =====================================================================
--  STORED FUNCTIONS
-- =====================================================================

DROP FUNCTION IF EXISTS fn_date_key$$
CREATE FUNCTION fn_date_key(p_date DATE) RETURNS INT
    DETERMINISTIC NO SQL
    COMMENT '2026-09-20 -> 20260920 (the date dimension key)'
    RETURN YEAR(p_date) * 10000 + MONTH(p_date) * 100 + DAY(p_date)$$

DROP FUNCTION IF EXISTS fn_growth_pct$$
CREATE FUNCTION fn_growth_pct(p_current DECIMAL(16,2), p_previous DECIMAL(16,2)) RETURNS DECIMAL(10,2)
    DETERMINISTIC NO SQL
    COMMENT 'percentage change; NULL when there is no previous value'
    RETURN IF(p_previous IS NULL OR p_previous = 0,
              NULL,
              ROUND((p_current - p_previous) / p_previous * 100, 2))$$

DROP FUNCTION IF EXISTS fn_customer_segment$$
CREATE FUNCTION fn_customer_segment(p_completed_orders INT) RETURNS VARCHAR(20)
    DETERMINISTIC NO SQL
    COMMENT 'same rules as the CASE in view v_customer_performance'
    RETURN CASE
               WHEN IFNULL(p_completed_orders, 0) = 0 THEN 'No purchases'
               WHEN p_completed_orders = 1            THEN 'One-time buyer'
               WHEN p_completed_orders BETWEEN 2 AND 7 THEN 'Repeat customer'
               ELSE 'Loyal customer'
           END$$

DROP FUNCTION IF EXISTS fn_order_total$$
CREATE FUNCTION fn_order_total(p_order_id INT UNSIGNED) RETURNS DECIMAL(14,2)
    READS SQL DATA
    COMMENT 'sum of the order lines - must always equal orders.total_amount'
    RETURN (SELECT COALESCE(SUM(quantity * unit_price), 0)
              FROM order_items
             WHERE order_id = p_order_id)$$

DROP FUNCTION IF EXISTS fn_customer_city_on$$
CREATE FUNCTION fn_customer_city_on(p_customer_id INT UNSIGNED, p_on DATE) RETURNS VARCHAR(100)
    READS SQL DATA
    COMMENT 'SCD point-in-time lookup: which city was this customer in on that date?'
    RETURN (SELECT city
              FROM dw_dim_customer
             WHERE customer_id = p_customer_id
               AND p_on BETWEEN effective_from AND effective_to
             LIMIT 1)$$

DROP FUNCTION IF EXISTS fn_product_price_on$$
CREATE FUNCTION fn_product_price_on(p_product_id INT UNSIGNED, p_on DATE) RETURNS DECIMAL(12,2)
    READS SQL DATA
    COMMENT 'SCD point-in-time lookup: what was the list price on that date?'
    RETURN (SELECT list_price
              FROM dw_dim_product
             WHERE product_id = p_product_id
               AND p_on BETWEEN effective_from AND effective_to
             LIMIT 1)$$

-- =====================================================================
--  sp_create_order : the same steps as POST /api/orders, inside the database
--  Errors are raised with SIGNAL; any error rolls everything back.
-- =====================================================================

DROP PROCEDURE IF EXISTS sp_create_order$$
CREATE PROCEDURE sp_create_order(
    IN  p_user_id      INT UNSIGNED,
    IN  p_customer_id  INT UNSIGNED,
    IN  p_product_id   INT UNSIGNED,
    IN  p_quantity     INT UNSIGNED,
    IN  p_order_date   DATE,
    IN  p_status       VARCHAR(20),
    OUT p_order_id     INT UNSIGNED
)
BEGIN
    DECLARE v_price     DECIMAL(12,2);
    DECLARE v_stock     INT UNSIGNED;
    DECLARE v_total     DECIMAL(14,2);
    DECLARE v_order_id  INT UNSIGNED;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_quantity IS NULL OR p_quantity < 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Quantity must be at least 1.';
    END IF;

    IF p_status IS NULL OR p_status NOT IN ('PENDING', 'PROCESSING', 'COMPLETED') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid order status.';
    END IF;

    START TRANSACTION;

    IF NOT EXISTS (SELECT 1 FROM customers
                    WHERE customer_id = p_customer_id AND user_id = p_user_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Customer not found.';
    END IF;

    -- FOR UPDATE locks the product row until COMMIT: two buyers cannot
    -- take the last unit at the same moment
    SELECT price, stock INTO v_price, v_stock
      FROM products
     WHERE product_id = p_product_id AND user_id = p_user_id
       FOR UPDATE;

    IF v_price IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Product not found.';
    END IF;

    IF p_quantity > v_stock THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Insufficient stock.';
    END IF;

    SET v_total = ROUND(v_price * p_quantity, 2);

    INSERT INTO orders (user_id, customer_id, order_date, status, total_amount)
    VALUES (p_user_id, p_customer_id, p_order_date, p_status, v_total);
    SET v_order_id = LAST_INSERT_ID();

    INSERT INTO order_items (order_id, product_id, quantity, unit_price)
    VALUES (v_order_id, p_product_id, p_quantity, v_price);

    INSERT INTO payments (order_id, payment_date, amount, payment_status)
    VALUES (v_order_id, p_order_date, v_total,
            IF(p_status = 'COMPLETED', 'PAID', 'PENDING'));

    UPDATE products SET stock = stock - p_quantity WHERE product_id = p_product_id;

    COMMIT;

    SET p_order_id = v_order_id;
END$$

-- =====================================================================
--  sp_dw_load_dim_date : fill the calendar dimension for a date range
-- =====================================================================

DROP PROCEDURE IF EXISTS sp_dw_load_dim_date$$
CREATE PROCEDURE sp_dw_load_dim_date(IN p_from DATE, IN p_to DATE)
BEGIN
    DECLARE v_old_depth BIGINT UNSIGNED;

    SET v_old_depth = @@SESSION.cte_max_recursion_depth;
    SET SESSION cte_max_recursion_depth = 40000;

    INSERT IGNORE INTO dw_dim_date
           (date_key, full_date, cal_year, cal_quarter, cal_month, month_name, month_key,
            day_of_month, day_of_week, day_name, is_weekend, iso_week)
    WITH RECURSIVE days (dt) AS (
        SELECT p_from
        UNION ALL
        SELECT DATE_ADD(dt, INTERVAL 1 DAY) FROM days WHERE dt < p_to
    )
    SELECT fn_date_key(dt), dt, YEAR(dt), QUARTER(dt), MONTH(dt), MONTHNAME(dt),
           DATE_FORMAT(dt, '%Y-%m'), DAY(dt), DAYOFWEEK(dt), DAYNAME(dt),
           IF(DAYOFWEEK(dt) IN (1, 7), 1, 0), WEEK(dt, 3)
      FROM days;

    SET SESSION cte_max_recursion_depth = v_old_depth;
END$$

-- =====================================================================
--  sp_dw_ensure_partitions : PARTITION MAINTENANCE
--  Splits the catch-all partition p_future into one partition per quarter,
--  up to the quarter that contains p_until.  Running it twice is harmless.
-- =====================================================================

DROP PROCEDURE IF EXISTS sp_dw_ensure_partitions$$
CREATE PROCEDURE sp_dw_ensure_partitions(IN p_until DATE)
BEGIN
    DECLARE v_lock   INT DEFAULT 0;
    DECLARE v_last   BIGINT;
    DECLARE v_start  DATE;
    DECLARE v_next   DATE;
    DECLARE v_name   VARCHAR(20);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        DO RELEASE_LOCK('eleczz_dw_partitions');
        RESIGNAL;
    END;

    SET SESSION information_schema_stats_expiry = 0;
    SET v_lock = IFNULL(GET_LOCK('eleczz_dw_partitions', 20), 0);

    IF v_lock = 1 THEN

        SELECT MAX(CAST(PARTITION_DESCRIPTION AS UNSIGNED)) INTO v_last
          FROM information_schema.PARTITIONS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'dw_fact_sales'
           AND PARTITION_DESCRIPTION REGEXP '^[0-9]+$';

        IF v_last IS NOT NULL THEN
            SET v_start = STR_TO_DATE(CAST(v_last AS CHAR), '%Y%m%d');

            WHILE v_start <= p_until DO
                SET v_next = DATE_ADD(v_start, INTERVAL 3 MONTH);
                SET v_name = CONCAT('p', YEAR(v_start), '_q', QUARTER(v_start));

                SET @eleczz_ddl = CONCAT(
                    'ALTER TABLE dw_fact_sales REORGANIZE PARTITION p_future INTO (',
                    'PARTITION ', v_name, ' VALUES LESS THAN (', DATE_FORMAT(v_next, '%Y%m%d'), '), ',
                    'PARTITION p_future VALUES LESS THAN MAXVALUE)');
                PREPARE eleczz_stmt FROM @eleczz_ddl;
                EXECUTE eleczz_stmt;
                DEALLOCATE PREPARE eleczz_stmt;

                SET v_start = v_next;
            END WHILE;
        END IF;

        DO RELEASE_LOCK('eleczz_dw_partitions');
    END IF;
END$$

-- =====================================================================
--  sp_dw_purge_orphans : facts cannot have a foreign key (they are
--  partitioned), so rows of deleted accounts are cleaned up here.
-- =====================================================================

DROP PROCEDURE IF EXISTS sp_dw_purge_orphans$$
CREATE PROCEDURE sp_dw_purge_orphans()
BEGIN
    DELETE FROM dw_fact_sales WHERE user_id NOT IN (SELECT user_id FROM users);
END$$

-- =====================================================================
--  sp_refresh_mv : rebuild the materialized views for one account
--  Runs in one transaction, so readers never see a half-built table.
-- =====================================================================

DROP PROCEDURE IF EXISTS sp_refresh_mv$$
CREATE PROCEDURE sp_refresh_mv(IN p_user_id INT UNSIGNED)
BEGIN
    DECLARE v_now DATETIME;
    DECLARE v_n   INT UNSIGNED;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    SET v_now = NOW();

    START TRANSACTION;

    -- ---- mv_sales_monthly : revenue of COMPLETED orders per month ----
    DELETE FROM mv_sales_monthly WHERE user_id = p_user_id;
    INSERT INTO mv_sales_monthly
           (user_id, month_key, orders_count, units_sold, revenue, avg_order_value, customers, refreshed_at)
    SELECT f.user_id, d.month_key,
           COUNT(DISTINCT f.order_id),
           SUM(f.quantity),
           SUM(f.line_amount),
           ROUND(SUM(f.line_amount) / COUNT(DISTINCT f.order_id), 2),
           COUNT(DISTINCT f.customer_id),
           v_now
      FROM dw_fact_sales f
      JOIN dw_dim_date d ON d.date_key = f.date_key
     WHERE f.user_id = p_user_id AND f.order_status = 'COMPLETED'
     GROUP BY f.user_id, d.month_key;
    SET v_n = ROW_COUNT();
    REPLACE INTO mv_status (user_id, mv_name, refreshed_at, row_count)
    VALUES (p_user_id, 'mv_sales_monthly', v_now, v_n);

    -- ---- mv_product_sales : per product, per category it belonged to at the time ----
    DELETE FROM mv_product_sales WHERE user_id = p_user_id;
    INSERT INTO mv_product_sales
           (user_id, product_id, category, product_name, units_sold, revenue, orders_count, refreshed_at)
    SELECT f.user_id, f.product_id, dp.category, dp.product_name,
           SUM(f.quantity), SUM(f.line_amount), COUNT(DISTINCT f.order_id), v_now
      FROM dw_fact_sales f
      JOIN dw_dim_product dp ON dp.product_sk = f.product_sk
     WHERE f.user_id = p_user_id AND f.order_status = 'COMPLETED'
     GROUP BY f.user_id, f.product_id, dp.category, dp.product_name;
    SET v_n = ROW_COUNT();
    REPLACE INTO mv_status (user_id, mv_name, refreshed_at, row_count)
    VALUES (p_user_id, 'mv_product_sales', v_now, v_n);

    -- ---- mv_city_sales : revenue per city the customer lived in AT THE TIME ----
    DELETE FROM mv_city_sales WHERE user_id = p_user_id;
    INSERT INTO mv_city_sales
           (user_id, city, orders_count, customers, revenue, refreshed_at)
    SELECT f.user_id, dc.city, COUNT(DISTINCT f.order_id), COUNT(DISTINCT f.customer_id),
           SUM(f.line_amount), v_now
      FROM dw_fact_sales f
      JOIN dw_dim_customer dc ON dc.customer_sk = f.customer_sk
     WHERE f.user_id = p_user_id AND f.order_status = 'COMPLETED'
     GROUP BY f.user_id, dc.city;
    SET v_n = ROW_COUNT();
    REPLACE INTO mv_status (user_id, mv_name, refreshed_at, row_count)
    VALUES (p_user_id, 'mv_city_sales', v_now, v_n);

    COMMIT;
END$$

-- =====================================================================
--  sp_etl_run : EXTRACT from the live tables, TRANSFORM, LOAD the warehouse
--
--   p_as_of is the date a change is considered to have happened.  A normal
--   run uses today's date; the demo data uses past dates to build history.
--
--   1. calendar + partitions
--   2. customer dimension  (SCD: city = Type 2, name/email = Type 1)
--   3. product dimension   (SCD: category, price = Type 2, name = Type 1)
--   4. fact table          (new order lines, status changes, key re-mapping)
--   5. materialized views
--   Steps 2-4 are ONE transaction: it all loads, or nothing does.
-- =====================================================================

DROP PROCEDURE IF EXISTS sp_etl_run$$
CREATE PROCEDURE sp_etl_run(IN p_user_id INT UNSIGNED, IN p_as_of DATE)
BEGIN
    DECLARE v_run_id     INT UNSIGNED DEFAULT NULL;
    DECLARE v_cust_new   INT UNSIGNED DEFAULT 0;
    DECLARE v_cust_chg   INT UNSIGNED DEFAULT 0;
    DECLARE v_prod_new   INT UNSIGNED DEFAULT 0;
    DECLARE v_prod_chg   INT UNSIGNED DEFAULT 0;
    DECLARE v_fact_ins   INT UNSIGNED DEFAULT 0;
    DECLARE v_fact_upd   INT UNSIGNED DEFAULT 0;
    DECLARE v_fact_map   INT UNSIGNED DEFAULT 0;
    DECLARE v_min_date   DATE;
    DECLARE v_max_date   DATE;
    DECLARE v_msg        VARCHAR(255);
    DECLARE v_have_lock  TINYINT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1 v_msg = MESSAGE_TEXT;
        ROLLBACK;
        UPDATE etl_run_log
           SET status = 'FAILED', finished_at = NOW(), message = LEFT(v_msg, 255)
         WHERE run_id = v_run_id;
        IF v_have_lock = 1 THEN
            DO RELEASE_LOCK(CONCAT('eleczz_etl_', p_user_id));
        END IF;
        RESIGNAL;
    END;

    -- one ETL run per account at a time (the nightly event and a button click must not overlap)
    IF IFNULL(GET_LOCK(CONCAT('eleczz_etl_', p_user_id), 0), 0) = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'An ETL run for this account is already in progress.';
    END IF;
    SET v_have_lock = 1;

    -- a run that was interrupted (server stopped, connection killed) would stay RUNNING forever
    UPDATE etl_run_log
       SET status = 'FAILED', finished_at = NOW(), message = 'Abandoned: the run never finished'
     WHERE user_id = p_user_id AND status = 'RUNNING'
       AND started_at < DATE_SUB(NOW(), INTERVAL 1 HOUR);

    INSERT INTO etl_run_log (user_id, as_of_date) VALUES (p_user_id, p_as_of);
    SET v_run_id = LAST_INSERT_ID();

    -- ---------- 1. calendar + partitions (DDL, so outside the transaction) ----------
    SELECT MIN(order_date), MAX(order_date) INTO v_min_date, v_max_date
      FROM orders WHERE user_id = p_user_id;

    IF v_max_date IS NOT NULL THEN
        -- guard rails: a typo such as the year 2999 must not create hundreds of partitions
        CALL sp_dw_ensure_partitions(LEAST(v_max_date, DATE_ADD(CURRENT_DATE, INTERVAL 2 YEAR)));
        CALL sp_dw_load_dim_date(
            GREATEST(STR_TO_DATE(CONCAT(YEAR(v_min_date), '-01-01'), '%Y-%m-%d'), '2000-01-01'),
            LEAST(STR_TO_DATE(CONCAT(YEAR(v_max_date), '-12-31'), '%Y-%m-%d'), '2099-12-31'));
    END IF;

    START TRANSACTION;

    -- ---------- 2. CUSTOMER DIMENSION ----------
    -- 2a  Type 1: overwrite attributes we do not keep history for
    UPDATE dw_dim_customer d
      JOIN customers c ON c.customer_id = d.customer_id
       SET d.name = c.name, d.email = c.email, d.signup_date = c.signup_date
     WHERE d.user_id = p_user_id
       AND (d.name <> c.name OR d.email <> c.email OR d.signup_date <> c.signup_date);

    -- 2b  a version created on/after p_as_of is corrected in place (same-day edit)
    UPDATE dw_dim_customer d
      JOIN customers c ON c.customer_id = d.customer_id
       SET d.city = c.city
     WHERE d.user_id = p_user_id AND d.is_current = 1
       AND d.city <> c.city AND d.effective_from >= p_as_of;

    -- 2c  Type 2: close the old version the day before the change
    UPDATE dw_dim_customer d
      JOIN customers c ON c.customer_id = d.customer_id
       SET d.effective_to = DATE_SUB(p_as_of, INTERVAL 1 DAY), d.is_current = 0
     WHERE d.user_id = p_user_id AND d.is_current = 1
       AND d.city <> c.city AND d.effective_from < p_as_of;
    SET v_cust_chg = ROW_COUNT();

    -- 2d  customers deleted from the live table: close their history
    UPDATE dw_dim_customer d
       SET d.effective_to = DATE_SUB(p_as_of, INTERVAL 1 DAY), d.is_current = 0
     WHERE d.user_id = p_user_id AND d.is_current = 1 AND d.effective_from < p_as_of
       AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.customer_id = d.customer_id);

    -- 2e  open a new current version for new customers and for the ones just closed
    INSERT INTO dw_dim_customer
           (user_id, customer_id, name, email, city, signup_date,
            effective_from, effective_to, is_current, version_no)
    SELECT c.user_id, c.customer_id, c.name, c.email, c.city, c.signup_date,
           IF(v.max_version IS NULL, '1900-01-01', p_as_of),
           '9999-12-31', 1, IFNULL(v.max_version, 0) + 1
      FROM customers c
      LEFT JOIN (SELECT customer_id, MAX(version_no) AS max_version
                   FROM dw_dim_customer
                  WHERE user_id = p_user_id
                  GROUP BY customer_id) v ON v.customer_id = c.customer_id
     WHERE c.user_id = p_user_id
       AND NOT EXISTS (SELECT 1 FROM dw_dim_customer d
                        WHERE d.customer_id = c.customer_id AND d.is_current = 1);
    SET v_cust_new = GREATEST(ROW_COUNT() - v_cust_chg, 0);

    -- ---------- 3. PRODUCT DIMENSION (same pattern) ----------
    UPDATE dw_dim_product d
      JOIN products p ON p.product_id = d.product_id
       SET d.product_name = p.product_name
     WHERE d.user_id = p_user_id AND d.product_name <> p.product_name;

    UPDATE dw_dim_product d
      JOIN products p ON p.product_id = d.product_id
       SET d.category = p.category, d.list_price = p.price
     WHERE d.user_id = p_user_id AND d.is_current = 1
       AND (d.category <> p.category OR d.list_price <> p.price)
       AND d.effective_from >= p_as_of;

    UPDATE dw_dim_product d
      JOIN products p ON p.product_id = d.product_id
       SET d.effective_to = DATE_SUB(p_as_of, INTERVAL 1 DAY), d.is_current = 0
     WHERE d.user_id = p_user_id AND d.is_current = 1
       AND (d.category <> p.category OR d.list_price <> p.price)
       AND d.effective_from < p_as_of;
    SET v_prod_chg = ROW_COUNT();

    UPDATE dw_dim_product d
       SET d.effective_to = DATE_SUB(p_as_of, INTERVAL 1 DAY), d.is_current = 0
     WHERE d.user_id = p_user_id AND d.is_current = 1 AND d.effective_from < p_as_of
       AND NOT EXISTS (SELECT 1 FROM products p WHERE p.product_id = d.product_id);

    INSERT INTO dw_dim_product
           (user_id, product_id, product_name, category, list_price,
            effective_from, effective_to, is_current, version_no)
    SELECT p.user_id, p.product_id, p.product_name, p.category, p.price,
           IF(v.max_version IS NULL, '1900-01-01', p_as_of),
           '9999-12-31', 1, IFNULL(v.max_version, 0) + 1
      FROM products p
      LEFT JOIN (SELECT product_id, MAX(version_no) AS max_version
                   FROM dw_dim_product
                  WHERE user_id = p_user_id
                  GROUP BY product_id) v ON v.product_id = p.product_id
     WHERE p.user_id = p_user_id
       AND NOT EXISTS (SELECT 1 FROM dw_dim_product d
                        WHERE d.product_id = p.product_id AND d.is_current = 1);
    SET v_prod_new = GREATEST(ROW_COUNT() - v_prod_chg, 0);

    -- ---------- 4. FACT TABLE ----------
    -- 4a  order lines that are not in the warehouse yet.
    --     Each line points at the dimension VERSION that was valid on the order date.
    INSERT INTO dw_fact_sales
           (order_item_id, date_key, user_id, order_id, customer_id, product_id,
            customer_sk, product_sk, order_status, payment_status,
            quantity, unit_price, line_amount)
    SELECT oi.order_item_id, fn_date_key(o.order_date), o.user_id, o.order_id,
           o.customer_id, oi.product_id, dc.customer_sk, dp.product_sk,
           o.status, pay.payment_status,
           oi.quantity, oi.unit_price, oi.quantity * oi.unit_price
      FROM order_items oi
      JOIN orders o ON o.order_id = oi.order_id
      JOIN dw_dim_customer dc ON dc.customer_id = o.customer_id
                             AND o.order_date BETWEEN dc.effective_from AND dc.effective_to
      JOIN dw_dim_product  dp ON dp.product_id = oi.product_id
                             AND o.order_date BETWEEN dp.effective_from AND dp.effective_to
      LEFT JOIN payments pay ON pay.payment_id =
                (SELECT MAX(x.payment_id) FROM payments x WHERE x.order_id = o.order_id)
     WHERE o.user_id = p_user_id
       AND NOT EXISTS (SELECT 1 FROM dw_fact_sales f
                        WHERE f.order_item_id = oi.order_item_id
                          AND f.date_key = fn_date_key(o.order_date));
    SET v_fact_ins = ROW_COUNT();

    -- 4b  orders whose status / payment changed since they were loaded
    UPDATE dw_fact_sales f
      JOIN orders o ON o.order_id = f.order_id
      LEFT JOIN payments pay ON pay.payment_id =
                (SELECT MAX(x.payment_id) FROM payments x WHERE x.order_id = o.order_id)
       SET f.order_status = o.status, f.payment_status = pay.payment_status
     WHERE f.user_id = p_user_id
       AND (f.order_status <> o.status OR NOT (f.payment_status <=> pay.payment_status));
    SET v_fact_upd = ROW_COUNT();

    -- 4c  re-point older facts at the dimension version valid on THEIR order date
    UPDATE dw_fact_sales f
      JOIN orders o ON o.order_id = f.order_id
      JOIN dw_dim_customer dc ON dc.customer_id = f.customer_id
                             AND o.order_date BETWEEN dc.effective_from AND dc.effective_to
       SET f.customer_sk = dc.customer_sk
     WHERE f.user_id = p_user_id AND f.customer_sk <> dc.customer_sk;
    SET v_fact_map = ROW_COUNT();

    UPDATE dw_fact_sales f
      JOIN orders o ON o.order_id = f.order_id
      JOIN dw_dim_product dp ON dp.product_id = f.product_id
                            AND o.order_date BETWEEN dp.effective_from AND dp.effective_to
       SET f.product_sk = dp.product_sk
     WHERE f.user_id = p_user_id AND f.product_sk <> dp.product_sk;
    SET v_fact_map = v_fact_map + ROW_COUNT();

    COMMIT;

    -- ---------- 5. materialized views ----------
    CALL sp_refresh_mv(p_user_id);

    UPDATE etl_run_log
       SET status = 'SUCCESS', finished_at = NOW(),
           customers_new = v_cust_new, customers_changed = v_cust_chg,
           products_new = v_prod_new,  products_changed = v_prod_chg,
           facts_inserted = v_fact_ins, facts_updated = v_fact_upd,
           facts_remapped = v_fact_map
     WHERE run_id = v_run_id;

    DO RELEASE_LOCK(CONCAT('eleczz_etl_', p_user_id));
END$$

-- =====================================================================
--  sp_etl_run_all : run the ETL for every account (used by the nightly event)
--  A failure for one account is skipped so the others still load.
-- =====================================================================

DROP PROCEDURE IF EXISTS sp_etl_run_all$$
CREATE PROCEDURE sp_etl_run_all(IN p_as_of DATE)
BEGIN
    DECLARE v_done INT DEFAULT 0;
    DECLARE v_uid  INT UNSIGNED;
    DECLARE cur CURSOR FOR SELECT user_id FROM users;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

    OPEN cur;
    account_loop: LOOP
        FETCH cur INTO v_uid;
        IF v_done = 1 THEN
            LEAVE account_loop;
        END IF;

        BEGIN
            DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;
            CALL sp_etl_run(v_uid, p_as_of);
        END;
    END LOOP;
    CLOSE cur;
END$$

-- =====================================================================
--  EVENT : nightly refresh.  Created DISABLED so nothing runs behind your back.
--  Turn it on with:   ALTER EVENT ev_nightly_warehouse_refresh ENABLE;
-- =====================================================================

DROP EVENT IF EXISTS ev_nightly_warehouse_refresh$$
CREATE EVENT ev_nightly_warehouse_refresh
    ON SCHEDULE EVERY 1 DAY STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 2 HOUR)
    DISABLE
    COMMENT 'Nightly warehouse load. Enable with: ALTER EVENT ev_nightly_warehouse_refresh ENABLE'
    DO CALL sp_etl_run_all(CURRENT_DATE)$$

DELIMITER ;
