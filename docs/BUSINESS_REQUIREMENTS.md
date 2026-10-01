# Business Requirements – Sales & Order Management Analytics System

*Step 1 of the project brief: understand what the business needs to track.*

## 1. Purpose

A retail / e-commerce business needs one place where it can

1. **record** its customers, products, orders and payments correctly, and
2. **analyse** that data to see how the business is performing.

The system is a MySQL database (the source of truth) with a small web application on top of it.
The database enforces the rules; the analytics are written in SQL.

## 2. Users

| User | What they do |
|---|---|
| Business owner / manager | Reads revenue, growth, best products and best customers |
| Sales / operations staff | Adds customers and products, creates orders, updates order status |
| Finance | Checks which orders are paid, pending or refunded |
| Analyst | Runs SQL directly, or connects Power BI / Tableau to the reporting views |

Each registered account is a separate workspace: it only ever sees its own data.

## 3. What must be tracked

| Entity | Table | Key facts |
|---|---|---|
| Customer | `customers` | name, email, city, signup date |
| Product | `products` | name, category, price, stock on hand |
| Order | `orders` | who ordered, date, status, total amount |
| Order line | `order_items` | which product, how many, the price **at that time** |
| Payment | `payments` | amount, date, status |
| Status change | `order_status_history` | every status change of every order (audit trail) |
| Account | `users` | login, company (password stored only as a bcrypt hash) |

## 4. Business rules

| # | Rule | Enforced by |
|---|---|---|
| BR-1 | An order belongs to exactly one customer and contains one or more product lines | Foreign keys, `order_items` table |
| BR-2 | A product can appear only once per order (quantity carries the amount) | `UNIQUE (order_id, product_id)` |
| BR-3 | Quantity is at least 1; prices, totals and payment amounts are never negative | `CHECK` constraints |
| BR-4 | Stock can never go negative; an order for more than the available stock is refused | `INT UNSIGNED` + stock check inside a locked transaction |
| BR-5 | The order total is calculated by the server from the stored price, never trusted from the browser | `routes/orders.js` |
| BR-6 | The price of a product **at the time of the order** is kept on the order line, so later price changes do not rewrite history | `order_items.unit_price` |
| BR-7 | A new order is saved together with its line, its payment and the stock reduction – all or nothing | Database transaction |
| BR-8 | A customer who has orders cannot be deleted; a product used in an order cannot be deleted | `ON DELETE RESTRICT` |
| BR-9 | Two customers in the same account cannot share an email address | `UNIQUE (user_id, email)` |
| BR-10 | **Revenue counts only COMPLETED orders** | Every revenue query and view |
| BR-11 | Completing an order marks its payment `PAID`; cancelling it marks the payment `REFUNDED` | `PUT /api/orders/:id/status` |
| BR-12 | Every order creation and every status change is logged automatically | Triggers on `orders` |
| BR-13 | A **repeat customer** has 2 or more completed orders | `v_dashboard_kpis`, `v_customer_performance` |
| BR-14 | An account can never read or change another account's data | Every query filters by `user_id` |

Known design decision: cancelling an order refunds the payment but does **not** put the stock back
(this matches the original application). It would be a one-line extension to restore stock.

## 5. Questions the business wants answered

| Business question | Answered by | Where |
|---|---|---|
| How much revenue did we make, and how many orders? | `SUM`, `COUNT` | `03_aggregations.sql` #1, view `v_dashboard_kpis` |
| What is the average order value? | `AVG` | `03_aggregations.sql` #1, #8 |
| How does revenue change month by month? | `GROUP BY` month, `LAG`, running `SUM() OVER` | `04_advanced_sql.sql` D2, view `v_monthly_revenue` |
| Which products sell best? | join + `SUM` + `RANK` | `03_aggregations.sql` #4, view `v_product_performance` |
| Which product categories earn the most? | `GROUP BY category`, `WITH ROLLUP` | `03_aggregations.sql` #5 |
| Who are our best customers? | `RANK`, `DENSE_RANK`, `ROW_NUMBER` | `04_advanced_sql.sql` D1, view `v_customer_performance` |
| Which customers come back to buy again? | CTE, `HAVING` | `04_advanced_sql.sql` B2, KPI `repeat_customers` |
| How do we group customers? | `CASE`, `NTILE` | `04_advanced_sql.sql` C, D3, E |
| Which customers never bought anything? | `LEFT JOIN`, `NOT EXISTS` | `02_joins.sql`, `04_advanced_sql.sql` A3 |
| Which products never sold? | `LEFT JOIN` | `02_joins.sql`, view `v_product_performance` |
| How many orders are pending / cancelled? | `GROUP BY status` | `03_aggregations.sql` #3, #9, view `v_order_status_summary` |
| Which payments are still outstanding? | join + `GROUP BY` | `03_aggregations.sql` #10 |
| Who changed an order's status, and when? | trigger + history table | `07_routines_triggers.sql` |

## 6. Out of scope

Shipping and delivery tracking, taxes and discounts, multiple currencies, staff roles inside one
account, and email notifications.
