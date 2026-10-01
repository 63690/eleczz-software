-- =====================================================================
-- 05_views.sql  -  REUSABLE REPORTING VIEWS
--
-- `npm run setup-db` creates these automatically. Every view has a
-- user_id column, so the app (and you) can filter one account's data:
--     SELECT * FROM v_monthly_revenue WHERE user_id = 1;
--
-- The web dashboard and the "SQL Reports" page read ONLY from these views.
-- Requires MySQL 8.0+ (window functions).
--
-- BEFORE YOU RUN: in MySQL Workbench double-click the 'eleczz' schema (it turns bold),
-- then run this file.  Demo data is needed for meaningful results:  npm run seed
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) v_order_details : one flat row per order (multi-table JOIN)
--    orders + customers + payments + item totals
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_order_details AS
SELECT  o.user_id,
        o.order_id,
        o.order_date,
        o.status,
        c.customer_id,
        c.name                       AS customer_name,
        c.city,
        o.total_amount,
        pay.payment_status,
        pay.payment_date,
        COALESCE(it.item_count, 0)   AS item_count,
        COALESCE(it.units, 0)        AS units
FROM orders o
JOIN      customers c   ON c.customer_id = o.customer_id
LEFT JOIN payments  pay ON pay.order_id  = o.order_id
LEFT JOIN (
            SELECT order_id,
                   COUNT(*)      AS item_count,
                   SUM(quantity) AS units
            FROM   order_items
            GROUP  BY order_id
          ) it          ON it.order_id   = o.order_id;


-- ---------------------------------------------------------------------
-- 2) v_monthly_revenue : revenue per month + running total + growth
--    Uses GROUP BY (inner query) and window functions SUM() OVER / LAG()
--    NOTE: LAG compares with the previous month THAT HAS SALES.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_monthly_revenue AS
SELECT  m.user_id,
        m.sales_month,
        m.completed_orders,
        m.revenue,
        m.avg_order_value,
        SUM(m.revenue) OVER (
            PARTITION BY m.user_id
            ORDER BY m.sales_month
            ROWS UNBOUNDED PRECEDING
        )                                                   AS running_revenue,
        LAG(m.revenue) OVER (
            PARTITION BY m.user_id ORDER BY m.sales_month
        )                                                   AS previous_month_revenue,
        ROUND(
            ( m.revenue - LAG(m.revenue) OVER (PARTITION BY m.user_id ORDER BY m.sales_month) )
            / NULLIF( LAG(m.revenue) OVER (PARTITION BY m.user_id ORDER BY m.sales_month), 0 )
            * 100, 2)                                       AS mom_growth_pct
FROM (
        SELECT  user_id,
                DATE_FORMAT(order_date, '%Y-%m')  AS sales_month,
                COUNT(*)                          AS completed_orders,
                SUM(total_amount)                 AS revenue,
                ROUND(AVG(total_amount), 2)       AS avg_order_value
        FROM    orders
        WHERE   status = 'COMPLETED'
        GROUP   BY user_id, DATE_FORMAT(order_date, '%Y-%m')
     ) m;


-- ---------------------------------------------------------------------
-- 3) v_product_performance : units + revenue per product, with ranking
--    LEFT JOIN keeps products that never sold (units_sold = 0).
--    Only COMPLETED orders count as revenue.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_product_performance AS
SELECT  p.user_id,
        p.product_id,
        p.product_name,
        p.category,
        p.price,
        p.stock,
        COALESCE(s.units_sold, 0)  AS units_sold,
        COALESCE(s.revenue, 0)     AS revenue,
        RANK() OVER (
            PARTITION BY p.user_id
            ORDER BY COALESCE(s.revenue, 0) DESC
        )                          AS revenue_rank
FROM products p
LEFT JOIN (
            SELECT  oi.product_id,
                    SUM(oi.quantity)                  AS units_sold,
                    SUM(oi.quantity * oi.unit_price)  AS revenue
            FROM    order_items oi
            JOIN    orders o ON o.order_id = oi.order_id
            WHERE   o.status = 'COMPLETED'
            GROUP   BY oi.product_id
          ) s ON s.product_id = p.product_id;


-- ---------------------------------------------------------------------
-- 4) v_customer_performance : revenue, order count, rank and SEGMENT
--    CASE expression = customer segmentation
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_customer_performance AS
SELECT  c.user_id,
        c.customer_id,
        c.name,
        c.email,
        c.city,
        c.signup_date,
        COALESCE(s.completed_orders, 0)  AS completed_orders,
        COALESCE(s.revenue, 0)           AS revenue,
        s.first_order_date,
        s.last_order_date,
        RANK() OVER (
            PARTITION BY c.user_id
            ORDER BY COALESCE(s.revenue, 0) DESC
        )                                AS revenue_rank,
        CASE
            WHEN COALESCE(s.completed_orders, 0) = 0 THEN 'No purchases'
            WHEN s.completed_orders = 1              THEN 'One-time buyer'
            WHEN s.completed_orders BETWEEN 2 AND 7  THEN 'Repeat customer'
            ELSE                                          'Loyal customer'      -- 8+ completed orders
        END                              AS segment
FROM customers c
LEFT JOIN (
            SELECT  customer_id,
                    COUNT(*)          AS completed_orders,
                    SUM(total_amount) AS revenue,
                    MIN(order_date)   AS first_order_date,
                    MAX(order_date)   AS last_order_date
            FROM    orders
            WHERE   status = 'COMPLETED'
            GROUP   BY customer_id
          ) s ON s.customer_id = c.customer_id;


-- ---------------------------------------------------------------------
-- 5) v_order_status_summary : orders per status with % share
--    SUM(COUNT(*)) OVER () = window function applied to an aggregate
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_order_status_summary AS
SELECT  user_id,
        status,
        COUNT(*)            AS order_count,
        SUM(total_amount)   AS total_amount,
        ROUND(COUNT(*) * 100 / SUM(COUNT(*)) OVER (PARTITION BY user_id), 2)  AS pct_of_orders
FROM    orders
GROUP   BY user_id, status;


-- ---------------------------------------------------------------------
-- 6) v_dashboard_kpis : the six headline numbers, one row per account
--    Built from scalar / correlated SUBQUERIES.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_dashboard_kpis AS
SELECT  u.user_id,

        ( SELECT COALESCE(SUM(o.total_amount), 0)
            FROM orders o
           WHERE o.user_id = u.user_id AND o.status = 'COMPLETED' )      AS total_revenue,

        ( SELECT COUNT(*)
            FROM orders o
           WHERE o.user_id = u.user_id AND o.status = 'COMPLETED' )      AS completed_orders,

        ( SELECT COALESCE(AVG(o.total_amount), 0)
            FROM orders o
           WHERE o.user_id = u.user_id AND o.status = 'COMPLETED' )      AS average_order_value,

        ( SELECT COUNT(*)
            FROM customers c
           WHERE c.user_id = u.user_id )                                 AS customer_count,

        ( SELECT COUNT(*)
            FROM products p
           WHERE p.user_id = u.user_id )                                 AS product_count,

        -- repeat customers = customers with 2 or more COMPLETED orders
        ( SELECT COUNT(*)
            FROM customers c
           WHERE c.user_id = u.user_id
             AND ( SELECT COUNT(*)
                     FROM orders o
                    WHERE o.customer_id = c.customer_id
                      AND o.status = 'COMPLETED' ) >= 2 )                AS repeat_customers
FROM users u;


-- ---------------------------------------------------------------------
-- HOW TO USE THE VIEWS  (these SELECTs are examples - run them freely)
-- ---------------------------------------------------------------------
SET @uid = (SELECT user_id FROM users WHERE email = 'demo@eleczz.com');

SELECT * FROM v_dashboard_kpis          WHERE user_id = @uid;
SELECT * FROM v_monthly_revenue         WHERE user_id = @uid ORDER BY sales_month;
SELECT * FROM v_product_performance     WHERE user_id = @uid ORDER BY revenue_rank LIMIT 10;
SELECT * FROM v_customer_performance    WHERE user_id = @uid ORDER BY revenue_rank LIMIT 10;
SELECT * FROM v_order_status_summary    WHERE user_id = @uid;
SELECT * FROM v_order_details           WHERE user_id = @uid ORDER BY order_id DESC LIMIT 20;
