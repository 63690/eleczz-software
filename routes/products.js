/* =========================================================
   /api/products
   ========================================================= */

const express = require("express");

const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const {
    HttpError,
    requireText,
    requireInt,
    requireMoney,
    idParam,
    wrap
} = require("../utils/helpers");

const router = express.Router();

router.use(requireAuth);

function readProduct(body) {
    return {
        product_name: requireText(body.product_name, "Product name", 160),
        category: requireText(body.category, "Category", 100),
        price: requireMoney(body.price, "Price"),
        stock: requireInt(body.stock, "Stock", 0)
    };
}

/* ---------- CREATE ---------- */

router.post("/", wrap(async (req, res) => {

    const p = readProduct(req.body);

    const [result] = await pool.query(
        `INSERT INTO products (user_id, product_name, category, price, stock)
         VALUES (?, ?, ?, ?, ?)`,
        [req.userId, p.product_name, p.category, p.price, p.stock]
    );

    res.status(201).json({ product_id: result.insertId, ...p });
}));

/* ---------- UPDATE ---------- */

router.put("/:id", wrap(async (req, res) => {

    const id = idParam(req.params.id);
    const p = readProduct(req.body);

    const [found] = await pool.query(
        "SELECT product_id FROM products WHERE product_id = ? AND user_id = ?",
        [id, req.userId]
    );

    if (!found.length) {
        throw new HttpError(404, "Product not found.");
    }

    await pool.query(
        `UPDATE products
            SET product_name = ?, category = ?, price = ?, stock = ?
          WHERE product_id = ? AND user_id = ?`,
        [p.product_name, p.category, p.price, p.stock, id, req.userId]
    );

    res.json({ product_id: id, ...p });
}));

/* ---------- DELETE ---------- */

router.delete("/:id", wrap(async (req, res) => {

    const id = idParam(req.params.id);

    const [used] = await pool.query(
        `SELECT oi.order_item_id
           FROM order_items oi
           JOIN orders o ON o.order_id = oi.order_id
          WHERE oi.product_id = ? AND o.user_id = ?
          LIMIT 1`,
        [id, req.userId]
    );

    if (used.length) {
        throw new HttpError(409, "Product is used in an order and cannot be deleted.");
    }

    const [result] = await pool.query(
        "DELETE FROM products WHERE product_id = ? AND user_id = ?",
        [id, req.userId]
    );

    if (!result.affectedRows) {
        throw new HttpError(404, "Product not found.");
    }

    res.json({ ok: true });
}));

module.exports = router;
