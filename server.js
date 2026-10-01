/* =========================================================
   ELECZZ SOFTWARE - SERVER
   Serves the frontend (/public) AND the API (/api/...).
   Because both come from the same address, no CORS setup
   is needed and the login cookie works out of the box.
   ========================================================= */

require("dotenv").config();

const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

/* ---------- fail fast if the configuration is unsafe ---------- */

const secret = process.env.JWT_SECRET || "";

if (secret.length < 32 || secret.startsWith("replace_me")) {
    console.error(
        "\n[ERROR] JWT_SECRET is missing, too short, or still the placeholder from .env.example.\n" +
        "        Set it in .env to a long random value. Generate one with:\n" +
        "        node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"\n"
    );
    process.exit(1);
}

const pool = require("./db");
const { HttpError } = require("./utils/helpers");

const app = express();

if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);       // correct client IPs behind Nginx / a host's proxy
}

app.disable("x-powered-by");

app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "SAMEORIGIN");
    res.set("Referrer-Policy", "same-origin");
    next();
});

app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

/* ---------- slow down password guessing ---------- */

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 50,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts. Please try again in a few minutes." }
});

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/signup", authLimiter);

/* ---------- API ---------- */

app.use("/api/auth", require("./routes/auth"));
app.use("/api/data", require("./routes/data"));
app.use("/api/analytics", require("./routes/analytics"));
app.use("/api/warehouse", require("./routes/warehouse"));
app.use("/api/bi", require("./routes/bi"));
app.use("/api/customers", require("./routes/customers"));
app.use("/api/products", require("./routes/products"));
app.use("/api/orders", require("./routes/orders"));

app.use("/api", (req, res) => {
    res.status(404).json({ error: "API route not found." });
});

/* ---------- FRONTEND ---------- */

app.use(express.static(path.join(__dirname, "public")));

/* ---------- ERROR HANDLER ---------- */

app.use((error, req, res, next) => {

    if (error instanceof HttpError) {
        return res.status(error.status).json({ error: error.message });
    }

    if (error.type === "entity.parse.failed") {
        return res.status(400).json({ error: "Invalid request data." });
    }

    if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "This record already exists (duplicate value)." });
    }

    if (error.code === "ER_CHECK_CONSTRAINT_VIOLATED") {
        return res.status(400).json({ error: "A value is outside the allowed range." });
    }

    if (error.code === "ER_ROW_IS_REFERENCED_2") {
        return res.status(409).json({ error: "This record is used by other records and cannot be deleted." });
    }

    console.error("[SERVER ERROR]", error);
    res.status(500).json({ error: "Something went wrong on the server. Please try again." });
});

/* ---------- START ---------- */

const PORT = Number(process.env.PORT) || 3000;

pool.query("SELECT 1")
    .then(() => {
        app.listen(PORT, () => {
            console.log(`\nELECZZ Software is running:  http://localhost:${PORT}\n`);
        });
    })
    .catch(error => {
        console.error(
            "\n[ERROR] Could not connect to MySQL: " + error.message + "\n" +
            "        Check DB_HOST / DB_USER / DB_PASSWORD / DB_NAME in your .env file,\n" +
            "        make sure MySQL is running, and run:  npm run setup-db\n"
        );
        process.exit(1);
    });
