-- =====================================================================
-- 07_routines_triggers.sql  -  TRIGGERS + STORED PROCEDURES
--
-- `npm run setup-db` creates these automatically (only the DROP / CREATE
-- statements are executed by the setup script; the CALL / SELECT examples
-- at the bottom are for you to run).
--
-- BEFORE YOU RUN: in MySQL Workbench double-click the 'eleczz' schema (it turns bold),
-- then run this file.  Demo data is needed for meaningful results:  npm run seed
-- =====================================================================


-- ---------------------------------------------------------------------
-- TRIGGER 1: log every NEW order in order_status_history
--            (old_status is NULL because the order did not exist before)
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_orders_after_insert;

CREATE TRIGGER trg_orders_after_insert
AFTER INSERT ON orders
FOR EACH ROW
    INSERT INTO order_status_history (order_id, old_status, new_status)
    VALUES (NEW.order_id, NULL, NEW.status);


-- ---------------------------------------------------------------------
-- TRIGGER 2: log every status CHANGE (only when the status really changed)
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_orders_after_update;

CREATE TRIGGER trg_orders_after_update
AFTER UPDATE ON orders
FOR EACH ROW
    INSERT INTO order_status_history (order_id, old_status, new_status)
    SELECT OLD.order_id, OLD.status, NEW.status
    FROM   DUAL
    WHERE  OLD.status <> NEW.status;


-- ---------------------------------------------------------------------
-- PROCEDURE 1: sales summary for one account between two dates
--              Uses COUNT, SUM, AVG, MIN and MAX in a single query.
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_sales_summary;

CREATE PROCEDURE sp_sales_summary(
    IN p_user_id INT UNSIGNED,
    IN p_from    DATE,
    IN p_to      DATE
)
    SELECT  COUNT(*)                          AS completed_orders,
            COALESCE(SUM(total_amount), 0)    AS revenue,
            COALESCE(ROUND(AVG(total_amount), 2), 0) AS avg_order_value,
            MIN(total_amount)                 AS smallest_order,
            MAX(total_amount)                 AS largest_order
    FROM    orders
    WHERE   user_id = p_user_id
      AND   status  = 'COMPLETED'
      AND   order_date BETWEEN p_from AND p_to;


-- ---------------------------------------------------------------------
-- PROCEDURE 2: top N products by revenue for one account
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_top_products;

CREATE PROCEDURE sp_top_products(
    IN p_user_id INT UNSIGNED,
    IN p_limit   INT
)
    SELECT  product_name, category, units_sold, revenue, revenue_rank
    FROM    v_product_performance
    WHERE   user_id = p_user_id
      AND   units_sold > 0
    ORDER   BY revenue DESC, product_id
    LIMIT   p_limit;


-- ---------------------------------------------------------------------
-- TRY IT (examples - run these yourself)
-- ---------------------------------------------------------------------
SET @uid = (SELECT user_id FROM users WHERE email = 'demo@eleczz.com');

CALL sp_sales_summary(@uid, '2026-01-01', '2026-06-30');    -- first half of 2026
CALL sp_top_products(@uid, 5);

-- Audit trail: change a status, then read the history table
--   UPDATE orders SET status = 'PROCESSING' WHERE order_id = 1001 AND user_id = @uid;
--   SELECT * FROM order_status_history WHERE order_id = 1001 ORDER BY history_id;
