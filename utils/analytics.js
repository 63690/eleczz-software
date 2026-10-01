/* =========================================================
   ANALYTICS  -  every number comes from a SQL VIEW

   No calculation happens in JavaScript. MySQL does all the
   SUM / COUNT / AVG / GROUP BY / RANK / LAG work through the
   views defined in sql/05_views.sql. This file only asks for
   the rows and turns MySQL's DECIMAL text ("499.50") into
   real numbers for the browser.
   ========================================================= */

const pool = require("../db");

function numbers(rows, fields) {
    return rows.map(row => {
        const copy = { ...row };
        fields.forEach(field => {
            if (copy[field] !== null && copy[field] !== undefined) {
                copy[field] = Number(copy[field]);
            }
        });
        return copy;
    });
}

async function getAnalytics(userId) {

    const [
        [kpiRows],
        [monthly],
        [status],
        [topProducts],
        [topCustomers],
        [categories],
        [segments],
        [idleCustomers],
        [unsoldProducts]
    ] = await Promise.all([

        /* six headline numbers */
        pool.query(
            `SELECT total_revenue, completed_orders, average_order_value,
                    customer_count, product_count, repeat_customers
               FROM v_dashboard_kpis
              WHERE user_id = ?`,
            [userId]
        ),

        /* revenue per month + running total + month-over-month growth */
        pool.query(
            `SELECT sales_month, completed_orders, revenue, avg_order_value,
                    running_revenue, previous_month_revenue, mom_growth_pct
               FROM v_monthly_revenue
              WHERE user_id = ?
              ORDER BY sales_month`,
            [userId]
        ),

        /* orders per status */
        pool.query(
            `SELECT status, order_count, total_amount, pct_of_orders
               FROM v_order_status_summary
              WHERE user_id = ?`,
            [userId]
        ),

        /* top 5 products by revenue */
        pool.query(
            `SELECT product_id, product_name, category, units_sold, revenue, revenue_rank
               FROM v_product_performance
              WHERE user_id = ? AND units_sold > 0
              ORDER BY revenue DESC, product_id
              LIMIT 5`,
            [userId]
        ),

        /* top 5 customers by revenue */
        pool.query(
            `SELECT customer_id, name, city, completed_orders, revenue, revenue_rank
               FROM v_customer_performance
              WHERE user_id = ? AND revenue > 0
              ORDER BY revenue DESC, customer_id
              LIMIT 5`,
            [userId]
        ),

        /* revenue per category with % share (window function over an aggregate) */
        pool.query(
            `SELECT category,
                    COUNT(*)           AS products,
                    SUM(units_sold)    AS units_sold,
                    SUM(revenue)       AS revenue,
                    ROUND(SUM(revenue) * 100 / NULLIF(SUM(SUM(revenue)) OVER (), 0), 1) AS pct_of_revenue
               FROM v_product_performance
              WHERE user_id = ?
              GROUP BY category
              ORDER BY revenue DESC`,
            [userId]
        ),

        /* customer segments */
        pool.query(
            `SELECT segment,
                    COUNT(*)      AS customers,
                    SUM(revenue)  AS revenue,
                    ROUND(SUM(revenue) * 100 / NULLIF(SUM(SUM(revenue)) OVER (), 0), 1) AS pct_of_revenue
               FROM v_customer_performance
              WHERE user_id = ?
              GROUP BY segment
              ORDER BY FIELD(segment, 'Loyal customer', 'Repeat customer', 'One-time buyer', 'No purchases')`,
            [userId]
        ),

        /* customers with no completed purchase (found with a LEFT JOIN inside the view) */
        pool.query(
            `SELECT customer_id, name, city, signup_date
               FROM v_customer_performance
              WHERE user_id = ? AND completed_orders = 0
              ORDER BY signup_date`,
            [userId]
        ),

        /* products that never sold (LEFT JOIN inside the view) */
        pool.query(
            `SELECT product_id, product_name, category, stock
               FROM v_product_performance
              WHERE user_id = ? AND units_sold = 0
              ORDER BY product_name`,
            [userId]
        )
    ]);

    const kpis = kpiRows[0] || {
        total_revenue: 0, completed_orders: 0, average_order_value: 0,
        customer_count: 0, product_count: 0, repeat_customers: 0
    };

    return {
        kpis: numbers([kpis], [
            "total_revenue", "completed_orders", "average_order_value",
            "customer_count", "product_count", "repeat_customers"
        ])[0],

        monthly_revenue: numbers(monthly, [
            "completed_orders", "revenue", "avg_order_value",
            "running_revenue", "previous_month_revenue", "mom_growth_pct"
        ]),

        order_status: numbers(status, ["order_count", "total_amount", "pct_of_orders"]),

        top_products: numbers(topProducts, ["units_sold", "revenue", "revenue_rank"]),

        top_customers: numbers(topCustomers, ["completed_orders", "revenue", "revenue_rank"]),

        category_performance: numbers(categories, ["products", "units_sold", "revenue", "pct_of_revenue"]),

        customer_segments: numbers(segments, ["customers", "revenue", "pct_of_revenue"]),

        idle_customers: idleCustomers,

        unsold_products: numbers(unsoldProducts, ["stock"])
    };
}

module.exports = { getAnalytics };
