-- =====================================================================
-- ELECZZ Software - DEMO HISTORY for the slowly changing dimensions
--                                                   (db/seed_history.sql)
--
-- Run AFTER db/seed.sql (npm run seed does both).  It gives the demo account
-- a believable past, so the warehouse has real dimension history to show:
--
--   customers   Sneha Reddy      Visakhapatnam -> Hyderabad   on 2026-03-01
--               Karthik S.       Madurai       -> Coimbatore  on 2026-05-01
--               Ananya Iyer      Pune          -> Bengaluru   on 2026-06-15
--   products    Duracell AA      price 520 -> 480             on 2026-02-01
--               HDMI 2.1 Cable   price 449 -> 499             on 2026-04-01
--               Tenda Extender   price 699 -> 749             on 2026-06-01
--               PIR Motion Sens. category Tools & Test -> Sensors & IoT  on 2026-07-01
--
-- How: put the live tables back to their OLD values, load the warehouse, then
-- apply each change in date order and run the ETL "as of" that date - exactly
-- what the nightly ETL would have done had it been running all year.
-- The live tables end up exactly as seed.sql left them (today's values).
-- =====================================================================

SET @uid = (SELECT user_id FROM users WHERE email = 'demo@eleczz.com');

-- facts of the previous demo account (they have no foreign key, see db/warehouse.sql)
CALL sp_dw_purge_orphans();

SET @c_sneha   = (SELECT customer_id FROM customers WHERE user_id = @uid AND name = 'Sneha Reddy');
SET @c_karthik = (SELECT customer_id FROM customers WHERE user_id = @uid AND name = 'Karthik Subramanian');
SET @c_ananya  = (SELECT customer_id FROM customers WHERE user_id = @uid AND name = 'Ananya Iyer');
SET @p_duracell = (SELECT product_id FROM products WHERE user_id = @uid AND product_name = 'Duracell AA Batteries (Pack of 10)');
SET @p_hdmi     = (SELECT product_id FROM products WHERE user_id = @uid AND product_name = 'HDMI 2.1 Cable 2m');
SET @p_tenda    = (SELECT product_id FROM products WHERE user_id = @uid AND product_name = 'Tenda 300 Mbps Wireless Extender');
SET @p_pir      = (SELECT product_id FROM products WHERE user_id = @uid AND product_name = 'PIR Motion Sensor Module');

-- ---------- 1. the OLD state of the live tables ----------
UPDATE customers SET city = 'Visakhapatnam' WHERE customer_id = @c_sneha;
UPDATE customers SET city = 'Madurai'       WHERE customer_id = @c_karthik;
UPDATE customers SET city = 'Pune'          WHERE customer_id = @c_ananya;
UPDATE products  SET price = 520 WHERE product_id = @p_duracell;
UPDATE products  SET price = 449 WHERE product_id = @p_hdmi;
UPDATE products  SET price = 699 WHERE product_id = @p_tenda;
UPDATE products  SET category = 'Tools & Test' WHERE product_id = @p_pir;

-- order lines placed before each price change were sold at the old price
UPDATE order_items oi JOIN orders o ON o.order_id = oi.order_id
   SET oi.unit_price = 520 WHERE oi.product_id = @p_duracell AND o.order_date < '2026-02-01';
UPDATE order_items oi JOIN orders o ON o.order_id = oi.order_id
   SET oi.unit_price = 449 WHERE oi.product_id = @p_hdmi     AND o.order_date < '2026-04-01';
UPDATE order_items oi JOIN orders o ON o.order_id = oi.order_id
   SET oi.unit_price = 699 WHERE oi.product_id = @p_tenda    AND o.order_date < '2026-06-01';

-- keep every order total and payment equal to the sum of its lines
UPDATE orders o
  JOIN (SELECT order_id, SUM(quantity * unit_price) AS t FROM order_items GROUP BY order_id) s
    ON s.order_id = o.order_id
   SET o.total_amount = s.t
 WHERE o.user_id = @uid;
UPDATE payments pay JOIN orders o ON o.order_id = pay.order_id
   SET pay.amount = o.total_amount
 WHERE o.user_id = @uid;

-- ---------- 2. first warehouse load: every dimension starts at version 1 ----------
CALL sp_etl_run(@uid, '2025-10-01');

-- ---------- 3. replay the changes in date order ----------
UPDATE products SET price = 480 WHERE product_id = @p_duracell;
CALL sp_etl_run(@uid, '2026-02-01');

UPDATE customers SET city = 'Hyderabad' WHERE customer_id = @c_sneha;
CALL sp_etl_run(@uid, '2026-03-01');

UPDATE products SET price = 499 WHERE product_id = @p_hdmi;
CALL sp_etl_run(@uid, '2026-04-01');

UPDATE customers SET city = 'Coimbatore' WHERE customer_id = @c_karthik;
CALL sp_etl_run(@uid, '2026-05-01');

UPDATE products SET price = 749 WHERE product_id = @p_tenda;
CALL sp_etl_run(@uid, '2026-06-01');

UPDATE customers SET city = 'Bengaluru' WHERE customer_id = @c_ananya;
CALL sp_etl_run(@uid, '2026-06-15');

UPDATE products SET category = 'Sensors & IoT' WHERE product_id = @p_pir;
CALL sp_etl_run(@uid, '2026-07-01');

-- ---------- 4. self-check ----------
SELECT (SELECT COUNT(*) FROM dw_dim_customer WHERE user_id = @uid)  AS customer_versions,
       (SELECT COUNT(*) FROM dw_dim_product  WHERE user_id = @uid)  AS product_versions,
       (SELECT COUNT(*) FROM dw_fact_sales   WHERE user_id = @uid)  AS fact_rows,
       (SELECT COUNT(*) FROM etl_run_log     WHERE user_id = @uid)  AS etl_runs;
