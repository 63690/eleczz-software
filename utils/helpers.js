/* =========================================================
   Small shared helpers: errors + input validation
   ========================================================= */

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

/* Trimmed, non-empty string with a max length. Throws 400 if invalid. */
function requireText(value, label, maxLength) {
    const text = typeof value === "string" ? value.trim() : "";

    if (!text) {
        throw new HttpError(400, `${label} is required.`);
    }

    if (text.length > maxLength) {
        throw new HttpError(400, `${label} must be at most ${maxLength} characters.`);
    }

    return text;
}

function requireEmail(value, label = "Email") {
    const email = requireText(value, label, 190).toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new HttpError(400, `${label} is not a valid email address.`);
    }

    return email;
}

/* "YYYY-MM-DD" that is also a real calendar date (rejects 2026-02-31). */
function requireDate(value, label = "Date") {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new HttpError(400, `${label} must be in YYYY-MM-DD format.`);
    }

    const parsed = new Date(value + "T00:00:00Z");

    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        throw new HttpError(400, `${label} is not a valid date.`);
    }

    return value;
}

/* Whole number >= min. */
function requireInt(value, label, min = 0) {
    const number = Number(value);

    if (!Number.isInteger(number) || number < min || number > 2147483647) {
        throw new HttpError(400, `${label} must be a whole number of at least ${min}.`);
    }

    return number;
}

/* Money: number >= 0 with at most 2 decimals. */
function requireMoney(value, label) {
    const number = Number(value);

    if (
        value === "" || value === null ||
        !Number.isFinite(number) || number < 0 || number > 9999999999.99
    ) {
        throw new HttpError(400, `${label} must be a valid amount.`);
    }

    return Math.round(number * 100) / 100;
}

/* Route param such as /customers/:id -> positive integer. */
function idParam(value) {
    const id = Number(value);

    if (!Number.isInteger(id) || id < 1) {
        throw new HttpError(400, "Invalid ID.");
    }

    return id;
}

/* Wrap async route handlers so thrown errors reach the error middleware. */
const wrap = handler => (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

module.exports = {
    HttpError,
    requireText,
    requireEmail,
    requireDate,
    requireInt,
    requireMoney,
    idParam,
    wrap
};
