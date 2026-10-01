-- =====================================================================
-- 06_view_reports.sql  -  READY-MADE BUSINESS REPORTS built on the views
-- (create the views first: npm run setup-db)
--
-- BEFORE YOU RUN: in MySQL Workbench double-click the 'eleczz' schema (it turns bold),
-- then run this file.  Demo data is needed for meaningful results:  npm run seed
-- =====================================================================

SET @uid = (SELECT user_id FROM users WHERE email = 'demo@eleczz.com');


-- 1) EXECUTIVE SUMMARY : the six headline numbers
SELECT total_revenue, completed_orders, ROUND(average_order_value, 2) AS avg_order_value,
       customer_count, product_count, repeat_customers
FROM   v_dashboard_kpis
WHERE  user_id = @uid;


-- 2) BEST AND WORST MONTH
(SELECT 'Best month'  AS what, sales_month, revenue FROM v_monthly_revenue
  WHERE user_id = @uid ORDER BY revenue DESC LIMIT 1)
UNION ALL
(SELECT 'Weakest month', sales_month, revenue FROM v_monthly_revenue
  WHERE user_id = @uid ORDER BY revenue ASC LIMIT 1);


-- 3) MONTHS WHERE REVENUE FELL compared with the month before
SELECT sales_month, revenue, previous_month_revenue, mom_growth_pct
FROM   v_monthly_revenue
WHERE  user_id = @uid AND mom_growth_pct < 0
ORDER  BY mom_growth_pct;


-- 4) RESTOCK ALERT : strong sellers that are almost out of stock
SELECT product_name, category, stock, units_sold, revenue
FROM   v_product_performance
WHERE  user_id = @uid AND stock <= 10 AND units_sold >= 20
ORDER  BY units_sold DESC;


-- 5) DEAD STOCK : plenty on the shelf, barely selling
SELECT product_name, category, stock, units_sold, stock * price AS stock_value
FROM   v_product_performance
WHERE  user_id = @uid AND stock >= 20 AND units_sold <= 15
ORDER  BY stock_value DESC;


-- 6) CUSTOMER SEGMENTS : how many customers, how much revenue
SELECT segment,
       COUNT(*)                                                   AS customers,
       SUM(revenue)                                               AS revenue,
       ROUND(SUM(revenue) * 100 / SUM(SUM(revenue)) OVER (), 1)   AS pct_of_revenue
FROM   v_customer_performance
WHERE  user_id = @uid
GROUP  BY segment
ORDER  BY FIELD(segment, 'Loyal customer', 'Repeat customer', 'One-time buyer', 'No purchases');


-- 7) TOP 5 CUSTOMERS  (revenue_rank comes from a window function inside the view)
SELECT revenue_rank, name, city, completed_orders, revenue
FROM   v_customer_performance
WHERE  user_id = @uid AND revenue > 0
ORDER  BY revenue_rank
LIMIT  5;


-- 8) OPERATIONS : orders still open after 7+ days
SELECT order_id, order_date, DATEDIFF('2026-09-20', order_date) AS days_open,
       customer_name, status, total_amount
FROM   v_order_details
WHERE  user_id = @uid
  AND  status IN ('PENDING', 'PROCESSING')
  AND  DATEDIFF('2026-09-20', order_date) >= 7
ORDER  BY days_open DESC;


-- 9) PAYMENT RECONCILIATION : money collected / waiting / returned
SELECT payment_status, COUNT(*) AS orders, SUM(total_amount) AS amount
FROM   v_order_details
WHERE  user_id = @uid
GROUP  BY payment_status;


-- 10) ORDER STATUS SHARE
SELECT status, order_count, total_amount, pct_of_orders
FROM   v_order_status_summary
WHERE  user_id = @uid
ORDER  BY order_count DESC;
