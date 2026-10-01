-- =====================================================================
-- 08_query_optimization.sql  -  INDEXES, EXPLAIN AND QUERY TUNING
--
-- Your real tables are small, so an index makes no visible difference.
-- To SEE the effect we build a practice table with 250,000 orders,
-- measure a report query, add indexes, and measure again.
--
-- Requires MySQL 8.0.18+ (EXPLAIN ANALYZE). Takes about 10-20 seconds.
-- Run the WHOLE file at once. The practice table is dropped at the end.
--
-- BEFORE YOU RUN: in MySQL Workbench double-click the 'eleczz' schema (it turns bold),
-- then run this file.  Demo data is needed for meaningful results:  npm run seed
-- =====================================================================


-- ---------------------------------------------------------------------
-- STEP 0 : build the practice table (NO indexes except the primary key)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS perf_orders;

CREATE TABLE perf_orders (
    order_id      INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    user_id       INT UNSIGNED  NOT NULL,
    customer_id   INT UNSIGNED  NOT NULL,
    order_date    DATE          NOT NULL,
    status        ENUM('PENDING','PROCESSING','COMPLETED','CANCELLED') NOT NULL,
    total_amount  DECIMAL(14,2) NOT NULL,
    PRIMARY KEY (order_id)
) ENGINE=InnoDB;

SET SESSION cte_max_recursion_depth = 250000;

INSERT INTO perf_orders (user_id, customer_id, order_date, status, total_amount)
WITH RECURSIVE seq AS (
        SELECT 1 AS n
        UNION ALL
        SELECT n + 1 FROM seq WHERE n < 250000
)
SELECT 1 + (n % 50),                                      -- 50 accounts
       1 + (n % 5000),                                    -- 5,000 customers
       DATE_ADD('2025-01-01', INTERVAL (n % 700) DAY),    -- ~2 years of dates
       CASE WHEN n % 10 < 8 THEN 'COMPLETED'
            WHEN n % 10 = 8 THEN 'PENDING' ELSE 'CANCELLED' END,
       100 + (n * 37 % 9000)
FROM   seq;

ANALYZE TABLE perf_orders;
SELECT COUNT(*) AS practice_rows FROM perf_orders;


-- ---------------------------------------------------------------------
-- THE QUERY WE WANT TO SPEED UP
-- "Monthly revenue of ONE account, COMPLETED orders, first half of 2026"
-- ---------------------------------------------------------------------

-- STEP 1 : BEFORE - no index.  Look for  type = ALL  (full table scan)
--          and the 'actual time' at the top of EXPLAIN ANALYZE.
EXPLAIN
SELECT DATE_FORMAT(order_date, '%Y-%m') AS month, SUM(total_amount) AS revenue
FROM   perf_orders
WHERE  user_id = 7 AND status = 'COMPLETED'
  AND  order_date BETWEEN '2026-01-01' AND '2026-06-30'
GROUP  BY DATE_FORMAT(order_date, '%Y-%m');

EXPLAIN ANALYZE
SELECT DATE_FORMAT(order_date, '%Y-%m') AS month, SUM(total_amount) AS revenue
FROM   perf_orders
WHERE  user_id = 7 AND status = 'COMPLETED'
  AND  order_date BETWEEN '2026-01-01' AND '2026-06-30'
GROUP  BY DATE_FORMAT(order_date, '%Y-%m');


-- STEP 2 : add a COMPOSITE index.  Column order matters:
--          equality columns first (user_id, status), range column last (order_date)
CREATE INDEX idx_perf_user_status_date ON perf_orders (user_id, status, order_date);

EXPLAIN
SELECT DATE_FORMAT(order_date, '%Y-%m') AS month, SUM(total_amount) AS revenue
FROM   perf_orders
WHERE  user_id = 7 AND status = 'COMPLETED'
  AND  order_date BETWEEN '2026-01-01' AND '2026-06-30'
GROUP  BY DATE_FORMAT(order_date, '%Y-%m');

EXPLAIN ANALYZE
SELECT DATE_FORMAT(order_date, '%Y-%m') AS month, SUM(total_amount) AS revenue
FROM   perf_orders
WHERE  user_id = 7 AND status = 'COMPLETED'
  AND  order_date BETWEEN '2026-01-01' AND '2026-06-30'
GROUP  BY DATE_FORMAT(order_date, '%Y-%m');


-- STEP 3 : a COVERING index also contains total_amount, so MySQL never has
--          to touch the table at all  ->  look for "Using index" in EXPLAIN
CREATE INDEX idx_perf_covering ON perf_orders (user_id, status, order_date, total_amount);

EXPLAIN
SELECT DATE_FORMAT(order_date, '%Y-%m') AS month, SUM(total_amount) AS revenue
FROM   perf_orders
WHERE  user_id = 7 AND status = 'COMPLETED'
  AND  order_date BETWEEN '2026-01-01' AND '2026-06-30'
GROUP  BY DATE_FORMAT(order_date, '%Y-%m');

EXPLAIN ANALYZE
SELECT DATE_FORMAT(order_date, '%Y-%m') AS month, SUM(total_amount) AS revenue
FROM   perf_orders
WHERE  user_id = 7 AND status = 'COMPLETED'
  AND  order_date BETWEEN '2026-01-01' AND '2026-06-30'
GROUP  BY DATE_FORMAT(order_date, '%Y-%m');


-- ---------------------------------------------------------------------
-- LESSON 2 : do not wrap an indexed column in a function
-- ---------------------------------------------------------------------
-- BAD  : YEAR(order_date) = 2026 must be calculated for every row,
--        so the index on order_date cannot be used
EXPLAIN ANALYZE
SELECT COUNT(*) FROM perf_orders
WHERE  user_id = 7 AND status = 'COMPLETED' AND YEAR(order_date) = 2026;

-- GOOD : compare the raw column with a range - the index is used
EXPLAIN ANALYZE
SELECT COUNT(*) FROM perf_orders
WHERE  user_id = 7 AND status = 'COMPLETED'
  AND  order_date >= '2026-01-01' AND order_date < '2027-01-01';


-- ---------------------------------------------------------------------
-- LESSON 3 : the REAL tables already use the indexes from schema.sql
-- ---------------------------------------------------------------------
SET @uid = (SELECT user_id FROM users WHERE email = 'demo@eleczz.com');

EXPLAIN
SELECT DATE_FORMAT(order_date, '%Y-%m') AS month, SUM(total_amount) AS revenue
FROM   orders
WHERE  user_id = @uid AND status = 'COMPLETED'
GROUP  BY DATE_FORMAT(order_date, '%Y-%m');
--   key = idx_orders_user_status_date

SHOW INDEX FROM orders;


-- ---------------------------------------------------------------------
-- CLEAN UP
-- ---------------------------------------------------------------------
DROP TABLE perf_orders;
