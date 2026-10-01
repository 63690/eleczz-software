/* =========================================================
   Authentication middleware
   The login token lives in an httpOnly cookie, so JavaScript
   in the browser can never read (or steal) it.
   ========================================================= */

const jwt = require("jsonwebtoken");

const COOKIE_NAME = "eleczz_token";
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

function cookieOptions() {
    return {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: SEVEN_DAYS,
        path: "/"
    };
}

function issueToken(res, userId) {
    const token = jwt.sign(
        { uid: userId },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );

    res.cookie(COOKIE_NAME, token, cookieOptions());
}

function clearToken(res) {
    const { maxAge, ...options } = cookieOptions();
    res.clearCookie(COOKIE_NAME, options);
}

/* Blocks the request unless the visitor is logged in. */
function requireAuth(req, res, next) {
    const token = req.cookies[COOKIE_NAME];

    if (!token) {
        return res.status(401).json({ error: "Please sign in." });
    }

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = payload.uid;
        next();
    } catch (error) {
        clearToken(res);
        res.status(401).json({ error: "Your session has expired. Please sign in again." });
    }
}

module.exports = { requireAuth, issueToken, clearToken };
