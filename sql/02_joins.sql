-- =====================================================================
-- 02_joins.sql  -  INNER JOIN, LEFT JOIN, multi-table and self joins
--
-- BEFORE YOU RUN: in MySQL Workbench double-click the 'eleczz' schema (it turns bold),
-- then run this file.  Demo data is needed for meaningful results:  npm run seed
-- =====================================================================

SET @uid = (SELECT user_id FROM users WHERE email = 'demo@eleczz.com');


-- ---------------------------------------------------------------------
-- 1) INNER JOIN : orders together with the customer who placed them
--    (only rows that match on BOTH sides)
-- ---------------------------------------------------------------------
SELECT o.order_id, o.order_date, c.name AS customer, c.city, o.status, o.total_amount
FROM   orders o
INNER JOIN customers c ON c.customer_id = o.customer_id
WHERE  o.user_id = @uid
ORDER  BY o.order_id DESC
LIMIT  15;


-- ---------------------------------------------------------------------
-- 2) MULTI-TABLE JOIN (5 tables) : the full story of every order
--    customer -> order -> item -> product, plus the payment
-- ---------------------------------------------------------------------
SELECT o.order_id,
       o.order_date,
       c.name                              AS customer,
       p.product_name,
       oi.quantity,
       oi.unit_price,
       oi.quantity * oi.unit_price         AS line_total,
       o.status                            AS order_status,
       pay.payment_status
FROM   orders o
JOIN   customers   c   ON c.customer_id = o.customer_id
JOIN   order_items oi  ON oi.order_id   = o.order_id
JOIN   products    p   ON p.product_id  = oi.product_id
JOIN   payments    pay ON pay.order_id  = o.order_id
WHERE  o.user_id = @uid
ORDER  BY o.order_id DESC, p.product_name
LIMIT  20;


-- ---------------------------------------------------------------------
-- 3) LEFT JOIN : keep everything from the LEFT table, even with no match
--    a) customers who have NEVER placed an order
-- ---------------------------------------------------------------------
SELECT c.customer_id, c.name, c.city, c.signup_date
FROM   customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id
WHERE  c.user_id = @uid
  AND  o.order_id IS NULL                 -- no matching order
ORDER  BY c.signup_date;

--    b) products that have NEVER been sold
SELECT p.product_id, p.product_name, p.category, p.stock
FROM   products p
LEFT JOIN order_items oi ON oi.product_id = p.product_id
WHERE  p.user_id = @uid
  AND  oi.order_item_id IS NULL
ORDER  BY p.product_name;

--    c) orders per customer INCLUDING customers with zero orders
SELECT c.name,
       COUNT(o.order_id)                   AS orders_placed,
       COALESCE(SUM(o.total_amount), 0)    AS total_ordered
FROM   customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id AND o.status <> 'CANCELLED'
WHERE  c.user_id = @uid
GROUP  BY c.customer_id, c.name
ORDER  BY orders_placed DESC, c.name;


-- ---------------------------------------------------------------------
-- 4) SELF JOIN : pairs of customers who live in the same city
-- ---------------------------------------------------------------------
SELECT a.city, a.name AS customer_one, b.name AS customer_two
FROM   customers a
JOIN   customers b ON b.city = a.city
                  AND b.customer_id > a.customer_id      -- avoids A-A and B-A duplicates
WHERE  a.user_id = @uid AND b.user_id = @uid
ORDER  BY a.city, a.name;


-- ---------------------------------------------------------------------
-- 5) JOIN FOR DATA QUALITY : orders whose payment status does not match
--    (a healthy database returns ZERO rows here)
-- ---------------------------------------------------------------------
SELECT o.order_id, o.status AS order_status, pay.payment_status
FROM   orders o
JOIN   payments pay ON pay.order_id = o.order_id
WHERE  o.user_id = @uid
  AND (   (o.status = 'COMPLETED' AND pay.payment_status <> 'PAID')
       OR (o.status = 'CANCELLED' AND pay.payment_status <> 'REFUNDED') );


-- ---------------------------------------------------------------------
-- 6) JOIN + aggregate check : does every order total equal the sum of
--    its items?  (again: ZERO rows means the data is consistent)
-- ---------------------------------------------------------------------
SELECT o.order_id, o.total_amount, SUM(oi.quantity * oi.unit_price) AS items_total
FROM   orders o
JOIN   order_items oi ON oi.order_id = o.order_id
WHERE  o.user_id = @uid
GROUP  BY o.order_id, o.total_amount
HAVING o.total_amount <> SUM(oi.quantity * oi.unit_price);
