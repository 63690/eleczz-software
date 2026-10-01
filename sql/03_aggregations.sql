-- =====================================================================
-- 03_aggregations.sql  -  SUM, COUNT, AVG, MIN, MAX, GROUP BY, HAVING
-- Business questions: revenue, order volume, average order value,
-- product performance.
--
-- Revenue always means COMPLETED orders only.
--
-- BEFORE YOU RUN: in MySQL Workbench double-click the 'eleczz' schema (it turns bold),
-- then run this file.  Demo data is needed for meaningful results:  npm run seed
-- =====================================================================

SET @uid = (SELECT user_id FROM users WHERE email = 'demo@eleczz.com');


-- ---------------------------------------------------------------------
-- 1) HEADLINE NUMBERS : all five aggregate functions in one query
-- ---------------------------------------------------------------------
SELECT COUNT(*)                     AS completed_orders,
       SUM(total_amount)            AS total_revenue,
       ROUND(AVG(total_amount), 2)  AS average_order_value,
       MIN(total_amount)            AS smallest_order,
       MAX(total_amount)            AS largest_order,
       COUNT(DISTINCT customer_id)  AS buying_customers
FROM   orders
WHERE  user_id = @uid AND status = 'COMPLETED';


-- ---------------------------------------------------------------------
-- 2) REVENUE BY MONTH   (the example from the project brief)
-- ---------------------------------------------------------------------
SELECT EXTRACT(YEAR  FROM order_date) AS year,
       EXTRACT(MONTH FROM order_date) AS month,
       COUNT(*)                       AS orders,
       SUM(total_amount)              AS revenue
FROM   orders
WHERE  user_id = @uid AND status = 'COMPLETED'
GROUP  BY 1, 2
ORDER  BY 1, 2;


-- ---------------------------------------------------------------------
-- 3) ORDER VOLUME BY STATUS
-- ---------------------------------------------------------------------
SELECT status,
       COUNT(*)            AS orders,
       SUM(total_amount)   AS value
FROM   orders
WHERE  user_id = @uid
GROUP  BY status
ORDER  BY orders DESC;


-- ---------------------------------------------------------------------
-- 4) TOP 10 PRODUCTS   (the example from the project brief)
-- ---------------------------------------------------------------------
SELECT p.product_name,
       SUM(oi.quantity)                  AS units_sold,
       SUM(oi.quantity * oi.unit_price)  AS revenue
FROM   order_items oi
JOIN   products p ON p.product_id = oi.product_id
JOIN   orders   o ON o.order_id   = oi.order_id
WHERE  o.user_id = @uid AND o.status = 'COMPLETED'
GROUP  BY p.product_id, p.product_name
ORDER  BY revenue DESC
LIMIT  10;


-- ---------------------------------------------------------------------
-- 5) REVENUE BY PRODUCT CATEGORY, with a grand-total row (WITH ROLLUP)
-- ---------------------------------------------------------------------
SELECT COALESCE(p.category, '** ALL CATEGORIES **')  AS category,
       SUM(oi.quantity)                              AS units_sold,
       SUM(oi.quantity * oi.unit_price)              AS revenue
FROM   order_items oi
JOIN   products p ON p.product_id = oi.product_id
JOIN   orders   o ON o.order_id   = oi.order_id
WHERE  o.user_id = @uid AND o.status = 'COMPLETED'
GROUP  BY p.category WITH ROLLUP;


-- ---------------------------------------------------------------------
-- 6) REVENUE BY CUSTOMER CITY
-- ---------------------------------------------------------------------
SELECT c.city,
       COUNT(DISTINCT c.customer_id)   AS customers,
       COUNT(o.order_id)               AS orders,
       SUM(o.total_amount)             AS revenue
FROM   orders o
JOIN   customers c ON c.customer_id = o.customer_id
WHERE  o.user_id = @uid AND o.status = 'COMPLETED'
GROUP  BY c.city
ORDER  BY revenue DESC;


-- ---------------------------------------------------------------------
-- 7) HAVING : filter AFTER grouping
--    a) customers with 10 or more completed orders
-- ---------------------------------------------------------------------
SELECT c.name, COUNT(*) AS orders, SUM(o.total_amount) AS revenue
FROM   orders o
JOIN   customers c ON c.customer_id = o.customer_id
WHERE  o.user_id = @uid AND o.status = 'COMPLETED'
GROUP  BY c.customer_id, c.name
HAVING COUNT(*) >= 10
ORDER  BY revenue DESC;

--    b) categories that earned more than Rs 1,00,000
SELECT p.category, SUM(oi.quantity * oi.unit_price) AS revenue
FROM   order_items oi
JOIN   products p ON p.product_id = oi.product_id
JOIN   orders   o ON o.order_id   = oi.order_id
WHERE  o.user_id = @uid AND o.status = 'COMPLETED'
GROUP  BY p.category
HAVING SUM(oi.quantity * oi.unit_price) > 100000
ORDER  BY revenue DESC;


-- ---------------------------------------------------------------------
-- 8) AVERAGE ORDER VALUE AND BASKET SIZE BY MONTH
-- ---------------------------------------------------------------------
SELECT DATE_FORMAT(o.order_date, '%Y-%m')     AS month,
       COUNT(DISTINCT o.order_id)             AS orders,
       ROUND(AVG(o.total_amount), 2)          AS avg_order_value,
       ROUND(COUNT(oi.order_item_id) / COUNT(DISTINCT o.order_id), 2) AS avg_items_per_order
FROM   orders o
JOIN   order_items oi ON oi.order_id = o.order_id
WHERE  o.user_id = @uid AND o.status = 'COMPLETED'
GROUP  BY DATE_FORMAT(o.order_date, '%Y-%m')
ORDER  BY month;


-- ---------------------------------------------------------------------
-- 9) CANCELLATION RATE BY MONTH
-- ---------------------------------------------------------------------
SELECT DATE_FORMAT(order_date, '%Y-%m')                              AS month,
       COUNT(*)                                                      AS all_orders,
       SUM(status = 'CANCELLED')                                     AS cancelled,
       ROUND(SUM(status = 'CANCELLED') * 100 / COUNT(*), 1)          AS cancel_pct
FROM   orders
WHERE  user_id = @uid
GROUP  BY DATE_FORMAT(order_date, '%Y-%m')
ORDER  BY month;


-- ---------------------------------------------------------------------
-- 10) PAYMENTS SUMMARY
-- ---------------------------------------------------------------------
SELECT pay.payment_status,
       COUNT(*)        AS payments,
       SUM(pay.amount) AS amount
FROM   payments pay
JOIN   orders o ON o.order_id = pay.order_id
WHERE  o.user_id = @uid
GROUP  BY pay.payment_status;
