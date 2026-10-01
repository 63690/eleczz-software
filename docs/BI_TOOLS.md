# Connecting Power BI or Tableau (optional extension)

The brief lists a *Power BI / Tableau dashboard connected to SQL* as an extension. **This project does not ship a
finished `.pbix` / `.twbx` file** – but everything a BI tool needs is ready: the reporting views already do all the
calculations, so a BI dashboard only has to draw them.

## What to connect to

| View | One row per | Good visual |
|---|---|---|
| `v_dashboard_kpis` | account | KPI cards (revenue, orders, average order value, repeat customers) |
| `v_monthly_revenue` | month | Line chart: `revenue`; second line: `running_revenue`; table with `mom_growth_pct` |
| `v_product_performance` | product | Bar chart: top 10 by `revenue`; scatter: `price` vs `units_sold` |
| `v_customer_performance` | customer | Table sorted by `revenue_rank`; donut by `segment` |
| `v_order_status_summary` | status | Donut / stacked bar |
| `v_order_details` | order | Detail table with slicers for `city`, `status`, `payment_status` |

Every view has a `user_id` column. Filter it to **one** account (for the demo data:
`SELECT user_id FROM users WHERE email = 'demo@eleczz.com';`) or your charts will add all accounts together.

## Power BI Desktop

1. Install the **MySQL Connector/NET** driver (from dev.mysql.com/downloads/connector/net) and restart Power BI.
2. **Home → Get data → MySQL database**.
3. Server `localhost`, database `eleczz` → choose **Database** login → user `root` and your password.
4. Tick the six `v_…` views → **Load**.
5. Add a **Slicer** on `user_id`, then build the visuals from the table above.

## Tableau

1. Install the MySQL driver (tableau.com/support/drivers → *MySQL*).
2. **Connect → To a Server → MySQL** → server `localhost`, port `3306`, user `root`, password.
3. Choose the `eleczz` database and drag the views onto the canvas.
4. Add a filter on `user_id`.

## Security note

Do not give a BI tool the `root` account for a real deployment. Create a read-only user:

```sql
CREATE USER 'eleczz_reader'@'localhost' IDENTIFIED BY 'a-strong-password';
GRANT SELECT ON eleczz.v_dashboard_kpis        TO 'eleczz_reader'@'localhost';
GRANT SELECT ON eleczz.v_monthly_revenue       TO 'eleczz_reader'@'localhost';
GRANT SELECT ON eleczz.v_product_performance   TO 'eleczz_reader'@'localhost';
GRANT SELECT ON eleczz.v_customer_performance  TO 'eleczz_reader'@'localhost';
GRANT SELECT ON eleczz.v_order_status_summary  TO 'eleczz_reader'@'localhost';
GRANT SELECT ON eleczz.v_order_details         TO 'eleczz_reader'@'localhost';
```
