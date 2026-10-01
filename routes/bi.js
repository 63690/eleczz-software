/* =========================================================
   /api/bi  -  the Dashboard Builder ("Power BI" of the website)

   GET    /datasets                 what can be charted
   GET    /templates                one-click dashboard templates
   POST   /query                    run ONE widget (returns the data + the SQL)
   GET    /dashboards               my saved dashboards
   POST   /dashboards               save a new dashboard
   POST   /dashboards/generate      create a dashboard from a template
   GET    /dashboards/:id           open one
   PUT    /dashboards/:id           save changes
   DELETE /dashboards/:id           delete
   ========================================================= */

const express = require("express");

const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { HttpError, requireText, idParam, wrap } = require("../utils/helpers");
const { TEMPLATES, publicDatasets, validateConfig, runQuery } = require("../utils/bi");

const router = express.Router();

router.use(requireAuth);

const MAX_DASHBOARDS = 30;
const MAX_WIDGETS = 16;

/* ---------- catalogue ---------- */

router.get("/datasets", (req, res) => {
    res.json({ datasets: publicDatasets() });
});

router.get("/templates", (req, res) => {
    res.json({
        templates: TEMPLATES.map(t => ({
            id: t.id, name: t.name, description: t.description, widgets: t.widgets.length
        }))
    });
});

router.post("/query", wrap(async (req, res) => {
    res.json(await runQuery(req.userId, req.body));
}));

/* ---------- helpers ---------- */

function cleanWidgets(list) {

    if (!Array.isArray(list) || list.length > MAX_WIDGETS) {
        throw new HttpError(400, `A dashboard can hold at most ${MAX_WIDGETS} widgets.`);
    }

    return list.map(w => ({
        title: requireText(w && w.title, "Widget title", 100),
        size: ["S", "M", "L"].includes(w.size) ? w.size : "M",
        config: validateConfig(w.config)
    }));
}

async function loadDashboard(connection, id, userId) {

    const [dash] = await connection.query(
        `SELECT dashboard_id, name, template, created_at, updated_at
           FROM bi_dashboards WHERE dashboard_id = ? AND user_id = ?`, [id, userId]);

    if (!dash.length) throw new HttpError(404, "Dashboard not found.");

    const [widgets] = await connection.query(
        `SELECT widget_id, position, title, size, config
           FROM bi_widgets WHERE dashboard_id = ? ORDER BY position`, [id]);

    return {
        dashboard: dash[0],
        widgets: widgets.map(w => ({
            ...w,
            config: typeof w.config === "string" ? JSON.parse(w.config) : w.config
        }))
    };
}

async function saveWidgets(connection, dashboardId, widgets) {

    await connection.query("DELETE FROM bi_widgets WHERE dashboard_id = ?", [dashboardId]);

    for (let i = 0; i < widgets.length; i++) {
        await connection.query(
            `INSERT INTO bi_widgets (dashboard_id, position, title, size, config) VALUES (?, ?, ?, ?, ?)`,
            [dashboardId, i, widgets[i].title, widgets[i].size, JSON.stringify(widgets[i].config)]);
    }
}

async function createDashboard(userId, name, template, widgets) {

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [[count]] = await connection.query(
            "SELECT COUNT(*) AS n FROM bi_dashboards WHERE user_id = ? FOR UPDATE", [userId]);

        if (count.n >= MAX_DASHBOARDS) {
            throw new HttpError(409, `You can keep at most ${MAX_DASHBOARDS} dashboards. Delete one first.`);
        }

        const [result] = await connection.query(
            "INSERT INTO bi_dashboards (user_id, name, template) VALUES (?, ?, ?)",
            [userId, name, template]);

        await saveWidgets(connection, result.insertId, widgets);
        await connection.commit();

        return await loadDashboard(pool, result.insertId, userId);

    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

/* ---------- dashboards ---------- */

router.get("/dashboards", wrap(async (req, res) => {

    const [rows] = await pool.query(
        `SELECT d.dashboard_id, d.name, d.template, d.updated_at, COUNT(w.widget_id) AS widgets
           FROM bi_dashboards d
           LEFT JOIN bi_widgets w ON w.dashboard_id = d.dashboard_id
          WHERE d.user_id = ?
          GROUP BY d.dashboard_id, d.name, d.template, d.updated_at
          ORDER BY d.updated_at DESC, d.dashboard_id DESC`, [req.userId]);

    res.json({ dashboards: rows.map(r => ({ ...r, widgets: Number(r.widgets) })) });
}));

router.post("/dashboards", wrap(async (req, res) => {

    const name = requireText(req.body.name, "Dashboard name", 80);
    const widgets = cleanWidgets(req.body.widgets === undefined ? [] : req.body.widgets);

    res.status(201).json(await createDashboard(req.userId, name, null, widgets));
}));

router.post("/dashboards/generate", wrap(async (req, res) => {

    const template = TEMPLATES.find(t => t.id === req.body.template);
    if (!template) throw new HttpError(404, "Unknown template.");

    const name = req.body.name ? requireText(req.body.name, "Dashboard name", 80) : template.name;

    res.status(201).json(await createDashboard(req.userId, name, template.id, cleanWidgets(template.widgets)));
}));

router.get("/dashboards/:id", wrap(async (req, res) => {
    res.json(await loadDashboard(pool, idParam(req.params.id), req.userId));
}));

router.put("/dashboards/:id", wrap(async (req, res) => {

    const id = idParam(req.params.id);
    const name = requireText(req.body.name, "Dashboard name", 80);
    const widgets = cleanWidgets(req.body.widgets);

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [found] = await connection.query(
            "SELECT dashboard_id FROM bi_dashboards WHERE dashboard_id = ? AND user_id = ? FOR UPDATE",
            [id, req.userId]);

        if (!found.length) throw new HttpError(404, "Dashboard not found.");

        await connection.query("UPDATE bi_dashboards SET name = ? WHERE dashboard_id = ?", [name, id]);
        await saveWidgets(connection, id, widgets);
        await connection.commit();

    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }

    res.json(await loadDashboard(pool, id, req.userId));
}));

router.delete("/dashboards/:id", wrap(async (req, res) => {

    const [result] = await pool.query(
        "DELETE FROM bi_dashboards WHERE dashboard_id = ? AND user_id = ?",
        [idParam(req.params.id), req.userId]);

    if (!result.affectedRows) throw new HttpError(404, "Dashboard not found.");

    res.json({ ok: true });
}));

module.exports = router;
