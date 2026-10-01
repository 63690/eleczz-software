-- =====================================================================
-- 04_advanced_sql.sql
--   A. Subqueries      B. CTEs (incl. recursive)     C. CASE
--   D. Window functions: ranking, running totals, month-over-month
--   E. Customer segmentation, cohorts and repeat purchases
--
-- Requires MySQL 8.0+.  Revenue = COMPLETED orders only.
--
-- BEFORE YOU RUN: in MySQL Workbench double-click the 'eleczz' schema (it turns bold),
-- then run this file.  Demo data is needed for meaningful results:  npm run seed
-- =====================================================================

SET @uid   = (SELECT user_id FROM users WHERE email = 'demo@eleczz.com');
SET @today = '2026-09-20';       -- fixed "report date" so results never change


-- =====================================================================
-- A. SUBQUERIES
-- =====================================================================

-- A1. Scalar subquery: orders bigger than the average order
SELECT order_id, order_date, total_amount
FROM   orders
WHERE  user_id = @uid AND status = 'COMPLETED'
  AND  total_amount > ( SELECT AVG(total_amount)
                          FROM orders
                         WHERE user_id = @uid AND status = 'COMPLETED' )
ORDER  BY total_amount DESC
LIMIT  10;

-- A2. IN subquery: customers who bought anything from the 'Networking' category
SELECT c.customer_id, c.name
FROM   customers c
WHERE  c.user_id = @uid
  AND  c.customer_id IN (
        SELECT o.customer_id
          FROM orders o
          JOIN order_items oi ON oi.order_id = o.order_id
          JOIN products p     ON p.product_id = oi.product_id
         WHERE p.category = 'Networking' AND o.status = 'COMPLETED' )
ORDER  BY c.name;

-- A3. NOT EXISTS: customers who have never had a COMPLETED order
SELECT c.customer_id, c.name, c.signup_date
FROM   customers c
WHERE  c.user_id = @uid
  AND  NOT EXISTS ( SELECT 1 FROM orders o
                     WHERE o.customer_id = c.customer_id AND o.status = 'COMPLETED' );

-- A4. Correlated subquery: each customer's MOST RECENT completed order
SELECT c.name,
       ( SELECT MAX(o.order_date)
           FROM orders o
          WHERE o.customer_id = c.customer_id AND o.status = 'COMPLETED' ) AS last_order_date
FROM   customers c
WHERE  c.user_id = @uid
ORDER  BY last_order_date DESC;

-- A5. Subquery in FROM (derived table): average revenue PER CUSTOMER
SELECT ROUND(AVG(customer_revenue), 2) AS avg_revenue_per_buying_customer
FROM ( SELECT customer_id, SUM(total_amount) AS customer_revenue
         FROM orders
        WHERE user_id = @uid AND status = 'COMPLETED'
        GROUP BY customer_id ) per_customer;


-- =====================================================================
-- B. CTEs  (WITH ... AS)
-- =====================================================================

-- B1. Monthly revenue and each month's SHARE of the total
WITH monthly AS (
        SELECT DATE_FORMAT(order_date, '%Y-%m') AS month,
               SUM(total_amount)                AS revenue
          FROM orders
         WHERE user_id = @uid AND status = 'COMPLETED'
         GROUP BY DATE_FORMAT(order_date, '%Y-%m')
)
SELECT month,
       revenue,
       ROUND(revenue * 100 / SUM(revenue) OVER (), 1) AS pct_of_total
FROM   monthly
ORDER  BY month;

-- B2. Repeat-purchase rate (two chained CTEs)
WITH orders_per_customer AS (
        SELECT customer_id, COUNT(*) AS orders
          FROM orders
         WHERE user_id = @uid AND status = 'COMPLETED'
         GROUP BY customer_id
),
summary AS (
        SELECT COUNT(*)                     AS buyers,
               SUM(orders >= 2)             AS repeat_buyers
          FROM orders_per_customer
)
SELECT buyers,
       repeat_buyers,
       ROUND(repeat_buyers * 100 / buyers, 1) AS repeat_rate_pct
FROM   summary;

-- B3. RECURSIVE CTE: a calendar of the last 12 months, so months with
--     no sales still appear (as 0) instead of silently disappearing
WITH RECURSIVE months AS (
        SELECT DATE_FORMAT(DATE_SUB(@today, INTERVAL 11 MONTH), '%Y-%m-01') AS month_start
        UNION ALL
        SELECT DATE_ADD(month_start, INTERVAL 1 MONTH)
          FROM months
         WHERE month_start < DATE_FORMAT(@today, '%Y-%m-01')
)
SELECT DATE_FORMAT(m.month_start, '%Y-%m')  AS month,
       COALESCE(SUM(o.total_amount), 0)     AS revenue
FROM   months m
LEFT JOIN orders o
       ON  DATE_FORMAT(o.order_date, '%Y-%m-01') = m.month_start
       AND o.user_id = @uid AND o.status = 'COMPLETED'
GROUP  BY m.month_start
ORDER  BY m.month_start;


-- =====================================================================
-- C. CASE EXPRESSIONS
-- =====================================================================

-- C1. Order size buckets
SELECT CASE
           WHEN total_amount <  2000  THEN '1. Small   (< 2,000)'
           WHEN total_amount < 10000  THEN '2. Medium  (2,000 - 9,999)'
           ELSE                            '3. Large   (10,000+)'
       END                    AS order_size,
       COUNT(*)               AS orders,
       SUM(total_amount)      AS revenue
FROM   orders
WHERE  user_id = @uid AND status = 'COMPLETED'
GROUP  BY order_size
ORDER  BY order_size;

-- C2. Conditional aggregation (pivot): orders per month, one column per status
SELECT DATE_FORMAT(order_date, '%Y-%m')          AS month,
       SUM(status = 'COMPLETED')                 AS completed,
       SUM(status = 'PROCESSING')                AS processing,
       SUM(status = 'PENDING')                   AS pending,
       SUM(status = 'CANCELLED')                 AS cancelled
FROM   orders
WHERE  user_id = @uid
GROUP  BY DATE_FORMAT(order_date, '%Y-%m')
ORDER  BY month;


-- =====================================================================
-- D. WINDOW FUNCTIONS
-- =====================================================================

-- D1. Customer ranking: RANK vs DENSE_RANK vs ROW_NUMBER
SELECT customer_id,
       SUM(total_amount)                                       AS revenue,
       RANK()       OVER (ORDER BY SUM(total_amount) DESC)     AS revenue_rank,
       DENSE_RANK() OVER (ORDER BY SUM(total_amount) DESC)     AS dense_rank_,
       ROW_NUMBER() OVER (ORDER BY SUM(total_amount) DESC)     AS row_no
FROM   orders
WHERE  user_id = @uid AND status = 'COMPLETED'
GROUP  BY customer_id
ORDER  BY revenue_rank
LIMIT  10;

-- D2. Running total, month-over-month change and 3-month moving average
WITH monthly AS (
        SELECT DATE_FORMAT(order_date, '%Y-%m') AS month,
               SUM(total_amount)                AS revenue
          FROM orders
         WHERE user_id = @uid AND status = 'COMPLETED'
         GROUP BY DATE_FORMAT(order_date, '%Y-%m')
)
SELECT month,
       revenue,
       SUM(revenue) OVER (ORDER BY month)                                   AS running_total,
       LAG(revenue) OVER (ORDER BY month)                                   AS previous_month,
       ROUND( (revenue - LAG(revenue) OVER (ORDER BY month))
              / LAG(revenue) OVER (ORDER BY month) * 100, 1)                AS mom_growth_pct,
       ROUND( AVG(revenue) OVER (ORDER BY month
                                 ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 0) AS moving_avg_3m
FROM   monthly
ORDER  BY month;

-- D3. NTILE: split buying customers into 4 spending quartiles (1 = top 25 %)
SELECT name, revenue, quartile
FROM ( SELECT c.name,
              SUM(o.total_amount)                                    AS revenue,
              NTILE(4) OVER (ORDER BY SUM(o.total_amount) DESC)      AS quartile
         FROM orders o
         JOIN customers c ON c.customer_id = o.customer_id
        WHERE o.user_id = @uid AND o.status = 'COMPLETED'
        GROUP BY c.customer_id, c.name ) q
ORDER  BY revenue DESC;

-- D4. Best-selling product in EACH category (ROW_NUMBER per partition)
WITH product_revenue AS (
        SELECT p.category, p.product_name,
               SUM(oi.quantity * oi.unit_price) AS revenue
          FROM order_items oi
          JOIN products p ON p.product_id = oi.product_id
          JOIN orders   o ON o.order_id   = oi.order_id
         WHERE o.user_id = @uid AND o.status = 'COMPLETED'
         GROUP BY p.product_id, p.category, p.product_name
),
ranked AS (
        SELECT category, product_name, revenue,
               ROW_NUMBER() OVER (PARTITION BY category ORDER BY revenue DESC) AS rn
          FROM product_revenue
)
SELECT category, product_name, revenue
FROM   ranked
WHERE  rn = 1
ORDER  BY revenue DESC;

-- D5. Days between a customer's consecutive orders (LAG on the date)
WITH gaps AS (
        SELECT customer_id,
               order_date,
               DATEDIFF(order_date,
                        LAG(order_date) OVER (PARTITION BY customer_id ORDER BY order_date, order_id)) AS days_since_previous
          FROM orders
         WHERE user_id = @uid AND status = 'COMPLETED'
)
SELECT c.name,
       COUNT(g.days_since_previous)             AS repeat_orders,
       ROUND(AVG(g.days_since_previous), 1)     AS avg_days_between_orders
FROM   gaps g
JOIN   customers c ON c.customer_id = g.customer_id
WHERE  g.days_since_previous IS NOT NULL
GROUP  BY c.customer_id, c.name
ORDER  BY avg_days_between_orders
LIMIT  10;

-- D6. Cumulative share of revenue by product (Pareto / 80-20 analysis)
WITH product_revenue AS (
        SELECT p.product_name, SUM(oi.quantity * oi.unit_price) AS revenue
          FROM order_items oi
          JOIN products p ON p.product_id = oi.product_id
          JOIN orders   o ON o.order_id   = oi.order_id
         WHERE o.user_id = @uid AND o.status = 'COMPLETED'
         GROUP BY p.product_id, p.product_name
)
SELECT product_name,
       revenue,
       ROUND(SUM(revenue) OVER (ORDER BY revenue DESC, product_name) * 100
             / SUM(revenue) OVER (), 1)                                    AS cumulative_pct
FROM   product_revenue
ORDER  BY revenue DESC, product_name;


-- =====================================================================
-- E. CUSTOMER SEGMENTATION, COHORTS, REPEAT PURCHASES
-- =====================================================================

-- E1. RFM segmentation (Recency, Frequency, Monetary) with CASE
WITH rfm AS (
        SELECT c.customer_id,
               c.name,
               DATEDIFF(@today, MAX(o.order_date))  AS recency_days,
               COUNT(*)                             AS frequency,
               SUM(o.total_amount)                  AS monetary
          FROM customers c
          JOIN orders o ON o.customer_id = c.customer_id AND o.status = 'COMPLETED'
         WHERE c.user_id = @uid
         GROUP BY c.customer_id, c.name
)
SELECT name, recency_days, frequency, monetary,
       CASE
           WHEN recency_days <= 30 AND frequency >= 8 THEN 'Champion'
           WHEN recency_days <= 60 AND frequency >= 3 THEN 'Active regular'
           WHEN recency_days >  90 AND frequency >= 3 THEN 'At risk (was regular)'
           WHEN frequency = 1                         THEN 'One-time buyer'
           ELSE                                            'Occasional'
       END AS segment
FROM   rfm
ORDER  BY monetary DESC;

-- E2. Segment summary for the RFM query above
WITH rfm AS (
        SELECT c.customer_id,
               DATEDIFF(@today, MAX(o.order_date))  AS recency_days,
               COUNT(*)                             AS frequency,
               SUM(o.total_amount)                  AS monetary
          FROM customers c
          JOIN orders o ON o.customer_id = c.customer_id AND o.status = 'COMPLETED'
         WHERE c.user_id = @uid
         GROUP BY c.customer_id
),
labelled AS (
        SELECT *,
               CASE
                   WHEN recency_days <= 30 AND frequency >= 8 THEN 'Champion'
                   WHEN recency_days <= 60 AND frequency >= 3 THEN 'Active regular'
                   WHEN recency_days >  90 AND frequency >= 3 THEN 'At risk (was regular)'
                   WHEN frequency = 1                         THEN 'One-time buyer'
                   ELSE                                            'Occasional'
               END AS segment
          FROM rfm
)
SELECT segment, COUNT(*) AS customers, SUM(monetary) AS revenue,
       ROUND(SUM(monetary) * 100 / SUM(SUM(monetary)) OVER (), 1) AS pct_of_revenue
FROM   labelled
GROUP  BY segment
ORDER  BY revenue DESC;

-- E3. Sign-up cohorts: of the customers who joined in each month,
--     how many went on to buy something?
SELECT DATE_FORMAT(c.signup_date, '%Y-%m')                         AS signup_month,
       COUNT(*)                                                    AS customers,
       SUM(EXISTS (SELECT 1 FROM orders o
                    WHERE o.customer_id = c.customer_id
                      AND o.status = 'COMPLETED'))                 AS bought,
       ROUND(SUM(EXISTS (SELECT 1 FROM orders o
                          WHERE o.customer_id = c.customer_id
                            AND o.status = 'COMPLETED')) * 100 / COUNT(*), 0) AS conversion_pct
FROM   customers c
WHERE  c.user_id = @uid
GROUP  BY DATE_FORMAT(c.signup_date, '%Y-%m')
ORDER  BY signup_month;

-- E4. Customers to win back: bought before, but nothing in the last 90 days
SELECT c.name, c.city, MAX(o.order_date) AS last_order,
       DATEDIFF(@today, MAX(o.order_date)) AS days_silent,
       SUM(o.total_amount) AS lifetime_revenue
FROM   customers c
JOIN   orders o ON o.customer_id = c.customer_id AND o.status = 'COMPLETED'
WHERE  c.user_id = @uid
GROUP  BY c.customer_id, c.name, c.city
HAVING days_silent > 90
ORDER  BY lifetime_revenue DESC;
