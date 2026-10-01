-- =====================================================================
-- 01_crud_operations.sql  -  CREATE / READ / UPDATE / DELETE
--
-- Everything runs inside a transaction that ends with ROLLBACK, so you
-- can run the whole file as often as you like without changing your data.
-- (Replace ROLLBACK with COMMIT at the bottom to keep the changes.)
--
-- Run the WHOLE file at once (Ctrl+Shift+Enter in MySQL Workbench).
--
-- BEFORE YOU RUN: in MySQL Workbench double-click the 'eleczz' schema (it turns bold),
-- then run this file.  Demo data is needed for meaningful results:  npm run seed
-- =====================================================================

SET @uid = (SELECT user_id FROM users WHERE email = 'demo@eleczz.com');

START TRANSACTION;

-- ---------------------------------------------------------------------
-- C = CREATE  (INSERT)
-- ---------------------------------------------------------------------
INSERT INTO customers (user_id, name, email, city, signup_date)
VALUES (@uid, 'Test Customer', 'test.customer@example.com', 'Chennai', '2026-09-20');
SET @new_customer = LAST_INSERT_ID();

INSERT INTO products (user_id, product_name, category, price, stock)
VALUES (@uid, 'Demo HDMI Cable 5m', 'Cables & Connectors', 299.00, 100);
SET @new_product = LAST_INSERT_ID();

-- several rows in one statement
INSERT INTO customers (user_id, name, email, city, signup_date) VALUES
    (@uid, 'Bulk One', 'bulk.one@example.com', 'Salem',  '2026-09-20'),
    (@uid, 'Bulk Two', 'bulk.two@example.com', 'Erode',  '2026-09-20');


-- ---------------------------------------------------------------------
-- R = READ  (SELECT)
-- ---------------------------------------------------------------------
-- one row by primary key
SELECT * FROM customers WHERE customer_id = @new_customer;

-- filter + sort
SELECT customer_id, name, city
FROM   customers
WHERE  user_id = @uid AND city = 'Chennai'
ORDER  BY name;

-- pattern search
SELECT product_name, price, stock
FROM   products
WHERE  user_id = @uid AND product_name LIKE '%Switch%'
ORDER  BY price DESC;

-- range + IN list
SELECT order_id, order_date, status, total_amount
FROM   orders
WHERE  user_id = @uid
  AND  order_date BETWEEN '2026-09-01' AND '2026-09-20'
  AND  status IN ('PENDING', 'PROCESSING')
ORDER  BY order_date;

-- paging: the 5 newest orders
SELECT order_id, order_date, status, total_amount
FROM   orders
WHERE  user_id = @uid
ORDER  BY order_id DESC
LIMIT  5;


-- ---------------------------------------------------------------------
-- U = UPDATE
-- ---------------------------------------------------------------------
UPDATE customers
SET    city = 'Madurai'
WHERE  customer_id = @new_customer AND user_id = @uid;

-- raise the price by 10 %
UPDATE products
SET    price = ROUND(price * 1.10, 2)
WHERE  product_id = @new_product AND user_id = @uid;

-- guarded update: only reduce stock when enough is available
UPDATE products
SET    stock = stock - 5
WHERE  product_id = @new_product AND user_id = @uid AND stock >= 5;

SELECT product_name, price, stock FROM products WHERE product_id = @new_product;


-- ---------------------------------------------------------------------
-- D = DELETE
-- ---------------------------------------------------------------------
DELETE FROM products  WHERE product_id  = @new_product  AND user_id = @uid;
DELETE FROM customers WHERE customer_id = @new_customer AND user_id = @uid;
DELETE FROM customers WHERE user_id = @uid AND email LIKE 'bulk.%@example.com';

SELECT COUNT(*) AS test_rows_left
FROM   customers
WHERE  user_id = @uid AND email LIKE '%@example.com';      -- 0


-- ---------------------------------------------------------------------
-- DATA INTEGRITY: the database protects itself.
-- Each statement below is commented out because it is SUPPOSED to fail.
-- Remove the -- and run one at a time to see the error.
-- ---------------------------------------------------------------------

-- 1) Foreign key: a customer who has orders cannot be deleted
--    DELETE FROM customers WHERE customer_id = (SELECT customer_id FROM orders LIMIT 1);
--    -> ERROR 1451: Cannot delete or update a parent row: a foreign key constraint fails

-- 2) CHECK constraint: a negative price is rejected
--    INSERT INTO products (user_id, product_name, category, price, stock)
--    VALUES (@uid, 'Bad product', 'Test', -50, 1);
--    -> ERROR 3819: Check constraint 'chk_products_price' is violated

-- 3) UNIQUE constraint: the same customer email twice in one account
--    INSERT INTO customers (user_id, name, email, city, signup_date)
--    SELECT user_id, 'Copy', email, city, signup_date FROM customers WHERE user_id = @uid LIMIT 1;
--    -> ERROR 1062: Duplicate entry ... for key 'uq_customers_user_email'

-- 4) Foreign key: an order for a customer that does not exist
--    INSERT INTO orders (user_id, customer_id, order_date, status, total_amount)
--    VALUES (@uid, 999999, '2026-09-20', 'PENDING', 100);
--    -> ERROR 1452: Cannot add or update a child row: a foreign key constraint fails

-- 5) NOT NULL / ENUM: an invalid order status
--    UPDATE orders SET status = 'SHIPPED' WHERE user_id = @uid LIMIT 1;
--    -> ERROR 1265: Data truncated for column 'status'

ROLLBACK;   -- undo everything above (use COMMIT to keep it)
