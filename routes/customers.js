/* =========================================================
   /api/customers
   Every query includes "AND user_id = ?" so one account can
   never see or change another account's records.
   ========================================================= */

const express = require("express");

const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const {
    HttpError,
    requireText,
    requireEmail,
    requireDate,
    idParam,
    wrap
} = require("../utils/helpers");

const router = express.Router();

router.use(requireAuth);

/* uq_customers_user_email: same email twice in one account */
function duplicateEmail(error) {
    if (error.code === "ER_DUP_ENTRY") {
        throw new HttpError(409, "A customer with this email already exists in your account.");
    }
    throw error;
}

function readCustomer(body) {
    return {
        name: requireText(body.name, "Name", 120),
        email: requireEmail(body.email),
        city: requireText(body.city, "City", 100),
        signup_date: requireDate(body.signup_date, "Signup date")
    };
}

/* ---------- CREATE ---------- */

router.post("/", wrap(async (req, res) => {

    const c = readCustomer(req.body);

    const [result] = await pool.query(
        `INSERT INTO customers (user_id, name, email, city, signup_date)
         VALUES (?, ?, ?, ?, ?)`,
        [req.userId, c.name, c.email, c.city, c.signup_date]
    ).catch(duplicateEmail);

    res.status(201).json({ customer_id: result.insertId, ...c });
}));

/* ---------- UPDATE ---------- */

router.put("/:id", wrap(async (req, res) => {

    const id = idParam(req.params.id);
    const c = readCustomer(req.body);

    const [found] = await pool.query(
        "SELECT customer_id FROM customers WHERE customer_id = ? AND user_id = ?",
        [id, req.userId]
    );

    if (!found.length) {
        throw new HttpError(404, "Customer not found.");
    }

    await pool.query(
        `UPDATE customers
            SET name = ?, email = ?, city = ?, signup_date = ?
          WHERE customer_id = ? AND user_id = ?`,
        [c.name, c.email, c.city, c.signup_date, id, req.userId]
    ).catch(duplicateEmail);

    res.json({ customer_id: id, ...c });
}));

/* ---------- DELETE ---------- */

router.delete("/:id", wrap(async (req, res) => {

    const id = idParam(req.params.id);

    const [orders] = await pool.query(
        "SELECT order_id FROM orders WHERE customer_id = ? AND user_id = ? LIMIT 1",
        [id, req.userId]
    );

    if (orders.length) {
        throw new HttpError(409, "Customer has existing orders and cannot be deleted.");
    }

    const [result] = await pool.query(
        "DELETE FROM customers WHERE customer_id = ? AND user_id = ?",
        [id, req.userId]
    );

    if (!result.affectedRows) {
        throw new HttpError(404, "Customer not found.");
    }

    res.json({ ok: true });
}));

module.exports = router;
