/* =========================================================
   /api/orders
   Creating an order touches 4 tables (orders, order_items,
   payments, products.stock). It runs inside ONE transaction:
   either everything is saved, or nothing is.
   ========================================================= */

const express = require("express");

const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const {
    HttpError,
    requireDate,
    requireInt,
    idParam,
    wrap
} = require("../utils/helpers");

const router = express.Router();

router.use(requireAuth);

const NEW_ORDER_STATUSES = ["COMPLETED", "PROCESSING", "PENDING"];
const ALL_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "CANCELLED"];

/* ---------- CREATE ORDER ---------- */

router.post("/", wrap(async (req, res) => {

    const customerId = requireInt(req.body.customer_id, "Customer", 1);
    const productId = requireInt(req.body.product_id, "Product", 1);
    const quantity = requireInt(req.body.quantity, "Quantity", 1);
    const orderDate = requireDate(req.body.order_date, "Order date");

    if (orderDate < "2000-01-01" || orderDate > "2099-12-31") {
        throw new HttpError(400, "Order date must be between the years 2000 and 2099.");
    }
    const status = req.body.status;

    if (!NEW_ORDER_STATUSES.includes(status)) {
        throw new HttpError(400, "Invalid order status.");
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [customers] = await connection.query(
            "SELECT customer_id FROM customers WHERE customer_id = ? AND user_id = ?",
            [customerId, req.userId]
        );

        if (!customers.length) {
            throw new HttpError(404, "Customer not found.");
        }

        // FOR UPDATE locks this product row until we commit, so two people
        // ordering the last item at the same moment cannot both succeed.
        const [products] = await connection.query(
            `SELECT product_id, price, stock
               FROM products
              WHERE product_id = ? AND user_id = ?
                FOR UPDATE`,
            [productId, req.userId]
        );

        if (!products.length) {
            throw new HttpError(404, "Product not found.");
        }

        const product = products[0];

        if (quantity > product.stock) {
            throw new HttpError(409, "Insufficient stock.");
        }

        // The SERVER calculates the total from the stored price.
        // (integer paise * quantity avoids floating-point rounding errors)
        const unitPrice = Number(product.price);
        const total = (Math.round(unitPrice * 100) * quantity) / 100;

        const [order] = await connection.query(
            `INSERT INTO orders (user_id, customer_id, order_date, status, total_amount)
             VALUES (?, ?, ?, ?, ?)`,
            [req.userId, customerId, orderDate, status, total]
        );

        await connection.query(
            `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
             VALUES (?, ?, ?, ?)`,
            [order.insertId, productId, quantity, unitPrice]
        );

        await connection.query(
            `INSERT INTO payments (order_id, payment_date, amount, payment_status)
             VALUES (?, ?, ?, ?)`,
            [
                order.insertId,
                orderDate,
                total,
                status === "COMPLETED" ? "PAID" : "PENDING"
            ]
        );

        await connection.query(
            "UPDATE products SET stock = stock - ? WHERE product_id = ?",
            [quantity, productId]
        );

        await connection.commit();

        res.status(201).json({ order_id: order.insertId });

    } catch (error) {
        await connection.rollback();
        throw error;

    } finally {
        connection.release();
    }
}));

/* ---------- CHANGE ORDER STATUS ---------- */

router.put("/:id/status", wrap(async (req, res) => {

    const id = idParam(req.params.id);
    const status = req.body.status;

    if (!ALL_STATUSES.includes(status)) {
        throw new HttpError(400, "Invalid order status.");
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [orders] = await connection.query(
            "SELECT order_id FROM orders WHERE order_id = ? AND user_id = ? FOR UPDATE",
            [id, req.userId]
        );

        if (!orders.length) {
            throw new HttpError(404, "Order not found.");
        }

        await connection.query(
            "UPDATE orders SET status = ? WHERE order_id = ?",
            [status, id]
        );

        // Same rules as the original frontend
        if (status === "COMPLETED") {
            await connection.query(
                "UPDATE payments SET payment_status = 'PAID' WHERE order_id = ?",
                [id]
            );
        }

        if (status === "CANCELLED") {
            await connection.query(
                "UPDATE payments SET payment_status = 'REFUNDED' WHERE order_id = ?",
                [id]
            );
        }

        await connection.commit();

        res.json({ ok: true });

    } catch (error) {
        await connection.rollback();
        throw error;

    } finally {
        connection.release();
    }
}));

module.exports = router;
