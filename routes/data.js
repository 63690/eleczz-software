/* =========================================================
   GET /api/data
   Returns everything the logged-in user owns, in exactly the
   shape the frontend already expects:
   { customers, products, orders, order_items, payments }
   ========================================================= */

const express = require("express");

const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { wrap } = require("../utils/helpers");
const { getAnalytics } = require("../utils/analytics");

const router = express.Router();

router.get("/", requireAuth, wrap(async (req, res) => {

    const userId = req.userId;

    const [
        [customers],
        [products],
        [orders],
        [orderItems],
        [payments],
        analytics
    ] = await Promise.all([

        pool.query(
            `SELECT customer_id, name, email, city, signup_date
               FROM customers WHERE user_id = ?
              ORDER BY customer_id`,
            [userId]
        ),

        pool.query(
            `SELECT product_id, product_name, category, price, stock
               FROM products WHERE user_id = ?
              ORDER BY product_id`,
            [userId]
        ),

        pool.query(
            `SELECT order_id, customer_id, order_date, status, total_amount
               FROM orders WHERE user_id = ?
              ORDER BY order_id`,
            [userId]
        ),

        pool.query(
            `SELECT oi.order_item_id, oi.order_id, oi.product_id,
                    oi.quantity, oi.unit_price
               FROM order_items oi
               JOIN orders o ON o.order_id = oi.order_id
              WHERE o.user_id = ?
              ORDER BY oi.order_item_id`,
            [userId]
        ),

        pool.query(
            `SELECT p.payment_id, p.order_id, p.payment_date,
                    p.amount, p.payment_status
               FROM payments p
               JOIN orders o ON o.order_id = p.order_id
              WHERE o.user_id = ?
              ORDER BY p.payment_id`,
            [userId]
        ),

        // dashboard + report numbers, calculated by MySQL views
        getAnalytics(userId)
    ]);

    // MySQL DECIMAL values arrive as text ("499.00"); the frontend does maths on them.
    res.json({
        customers,
        products: products.map(row => ({ ...row, price: Number(row.price) })),
        orders: orders.map(row => ({ ...row, total_amount: Number(row.total_amount) })),
        order_items: orderItems.map(row => ({ ...row, unit_price: Number(row.unit_price) })),
        payments: payments.map(row => ({ ...row, amount: Number(row.amount) })),
        analytics
    });
}));

module.exports = router;
