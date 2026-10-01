-- =====================================================================
-- 09_transactions.sql  -  TRANSACTIONS  (ACID in practice)
--
-- The website places an order with exactly these steps. Either ALL of
-- them are saved (COMMIT) or NONE of them (ROLLBACK).
--
-- Run the WHOLE file at once. It cleans up after itself at the end.
--
-- BEFORE YOU RUN: in MySQL Workbench double-click the 'eleczz' schema (it turns bold),
-- then run this file.  Demo data is needed for meaningful results:  npm run seed
-- =====================================================================

SET @uid  = (SELECT user_id FROM users WHERE email = 'demo@eleczz.com');
SET @cust = (SELECT MIN(customer_id) FROM customers WHERE user_id = @uid);
SET @prod = (SELECT MIN(product_id)  FROM products  WHERE user_id = @uid AND stock >= 5);

SELECT stock AS stock_before FROM products WHERE product_id = @prod;


-- ---------------------------------------------------------------------
-- TRANSACTION 1 : place an order  ->  COMMIT
-- ---------------------------------------------------------------------
START TRANSACTION;

-- lock the product row so nobody else can buy the same stock meanwhile
SELECT product_id, price, stock
FROM   products
WHERE  product_id = @prod AND user_id = @uid
FOR UPDATE;

SET @price = (SELECT price FROM products WHERE product_id = @prod);

INSERT INTO orders (user_id, customer_id, order_date, status, total_amount)
VALUES (@uid, @cust, '2026-09-20', 'PENDING', @price * 2);
SET @order_id = LAST_INSERT_ID();

INSERT INTO order_items (order_id, product_id, quantity, unit_price)
VALUES (@order_id, @prod, 2, @price);

INSERT INTO payments (order_id, payment_date, amount, payment_status)
VALUES (@order_id, '2026-09-20', @price * 2, 'PENDING');

UPDATE products SET stock = stock - 2 WHERE product_id = @prod;

COMMIT;          -- all four changes become permanent together

SELECT 'after COMMIT' AS step,
       (SELECT stock FROM products WHERE product_id = @prod)                      AS stock,
       (SELECT COUNT(*) FROM order_items WHERE order_id = @order_id)              AS items,
       (SELECT COUNT(*) FROM payments    WHERE order_id = @order_id)              AS payments;


-- ---------------------------------------------------------------------
-- TRANSACTION 2 : something goes wrong  ->  ROLLBACK
-- ---------------------------------------------------------------------
START TRANSACTION;

DELETE FROM payments    WHERE order_id = @order_id;     -- oops
DELETE FROM order_items WHERE order_id = @order_id;     -- oops

SELECT 'inside the transaction' AS step,
       (SELECT COUNT(*) FROM order_items WHERE order_id = @order_id) AS items,
       (SELECT COUNT(*) FROM payments    WHERE order_id = @order_id) AS payments;

ROLLBACK;        -- undo both deletes

SELECT 'after ROLLBACK' AS step,
       (SELECT COUNT(*) FROM order_items WHERE order_id = @order_id) AS items,
       (SELECT COUNT(*) FROM payments    WHERE order_id = @order_id) AS payments;


-- ---------------------------------------------------------------------
-- The audit trigger recorded the new order automatically
-- ---------------------------------------------------------------------
SELECT * FROM order_status_history WHERE order_id = @order_id;


-- ---------------------------------------------------------------------
-- CLEAN UP : remove the practice order and put the stock back
-- ---------------------------------------------------------------------
START TRANSACTION;
DELETE FROM orders WHERE order_id = @order_id AND user_id = @uid;   -- cascades to items, payments, history
UPDATE products SET stock = stock + 2 WHERE product_id = @prod;
COMMIT;

SELECT stock AS stock_after_cleanup FROM products WHERE product_id = @prod;   -- same as stock_before
