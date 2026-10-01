/* =========================================================
   GET /api/analytics
   The same SQL-view-based reports that power the Dashboard and
   the "SQL Reports" page. Handy for Postman, Power BI, Tableau
   (Web connector) or any other tool that reads JSON.
   ========================================================= */

const express = require("express");

const { requireAuth } = require("../middleware/auth");
const { getAnalytics } = require("../utils/analytics");
const { wrap } = require("../utils/helpers");

const router = express.Router();

router.get("/", requireAuth, wrap(async (req, res) => {
    res.json(await getAnalytics(req.userId));
}));

module.exports = router;
