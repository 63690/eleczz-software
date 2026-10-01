/* =========================================================
   /api/auth  -  sign up, log in, log out, "who am I"
   ========================================================= */

const express = require("express");
const bcrypt = require("bcryptjs");

const pool = require("../db");
const { requireAuth, issueToken, clearToken } = require("../middleware/auth");
const {
    HttpError,
    requireText,
    requireEmail,
    wrap
} = require("../utils/helpers");

const router = express.Router();

/* Used to keep login timing similar when the email does not exist. */
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

function publicUser(row) {
    return {
        id: row.user_id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        company: row.company
    };
}

/* ---------- SIGN UP ---------- */

router.post("/signup", wrap(async (req, res) => {

    const name = requireText(req.body.name, "Full name", 120);
    const email = requireEmail(req.body.email);
    const phone = requireText(req.body.phone, "Phone number", 30);
    const company = requireText(req.body.company, "Company", 160);
    const password = typeof req.body.password === "string" ? req.body.password : "";

    if (password.length < 6) {
        throw new HttpError(400, "Password must be at least 6 characters.");
    }

    if (password.length > 72) {
        // bcrypt only uses the first 72 bytes
        throw new HttpError(400, "Password must be at most 72 characters.");
    }

    const passwordHash = await bcrypt.hash(password, 10);

    let result;

    try {
        [result] = await pool.query(
            `INSERT INTO users (name, email, phone, company, password_hash)
             VALUES (?, ?, ?, ?, ?)`,
            [name, email, phone, company, passwordHash]
        );
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            throw new HttpError(409, "An account with this email already exists.");
        }
        throw error;
    }

    issueToken(res, result.insertId);

    res.status(201).json({
        user: { id: result.insertId, name, email, phone, company }
    });
}));

/* ---------- LOG IN ---------- */

router.post("/login", wrap(async (req, res) => {

    const email = typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const password = typeof req.body.password === "string"
        ? req.body.password
        : "";

    const [rows] = await pool.query(
        "SELECT * FROM users WHERE email = ?",
        [email]
    );

    const user = rows[0];

    const passwordOk = await bcrypt.compare(
        password,
        user ? user.password_hash : DUMMY_HASH
    );

    if (!user || !passwordOk) {
        throw new HttpError(401, "Invalid email or password.");
    }

    issueToken(res, user.user_id);

    res.json({ user: publicUser(user) });
}));

/* ---------- LOG OUT ---------- */

router.post("/logout", (req, res) => {
    clearToken(res);
    res.json({ ok: true });
});

/* ---------- CURRENT USER (used to restore the session on page load) ---------- */

router.get("/me", requireAuth, wrap(async (req, res) => {

    const [rows] = await pool.query(
        "SELECT * FROM users WHERE user_id = ?",
        [req.userId]
    );

    if (!rows.length) {
        clearToken(res);
        throw new HttpError(401, "Account not found. Please sign in again.");
    }

    res.json({ user: publicUser(rows[0]) });
}));

module.exports = router;
