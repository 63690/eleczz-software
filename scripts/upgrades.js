/* =========================================================
   DATABASE UPGRADES  (version 1  ->  version 2)

   db/schema.sql already contains everything for a NEW database.
   This list brings an OLD database (created by the first version
   of this project) up to date WITHOUT deleting any data.

   Every step first checks whether it is already applied, so the
   list can safely run on every `npm run setup-db`.
   ========================================================= */

module.exports = [

    /* ---------- customers ---------- */
    {
        kind: "unique", table: "customers", name: "uq_customers_user_email",
        sql: "ALTER TABLE customers ADD CONSTRAINT uq_customers_user_email UNIQUE (user_id, email)",
        hint: "Two customers in one account share an email. Fix the duplicate rows, then run setup-db again."
    },
    {
        kind: "index", table: "customers", name: "idx_customers_user_city",
        sql: "CREATE INDEX idx_customers_user_city ON customers (user_id, city)"
    },
    {
        kind: "check", table: "customers", name: "chk_customers_email",
        sql: "ALTER TABLE customers ADD CONSTRAINT chk_customers_email CHECK (email LIKE '%@%.%')"
    },
    { kind: "drop_index", table: "customers", name: "idx_customers_user", replacedBy: "uq_customers_user_email" },

    /* ---------- products ---------- */
    {
        kind: "index", table: "products", name: "idx_products_user_category",
        sql: "CREATE INDEX idx_products_user_category ON products (user_id, category)"
    },
    {
        kind: "check", table: "products", name: "chk_products_price",
        sql: "ALTER TABLE products ADD CONSTRAINT chk_products_price CHECK (price >= 0)"
    },
    { kind: "drop_index", table: "products", name: "idx_products_user", replacedBy: "idx_products_user_category" },

    /* ---------- orders ---------- */
    {
        kind: "index", table: "orders", name: "idx_orders_user_status_date",
        sql: "CREATE INDEX idx_orders_user_status_date ON orders (user_id, status, order_date)"
    },
    {
        kind: "index", table: "orders", name: "idx_orders_status_date",
        sql: "CREATE INDEX idx_orders_status_date ON orders (status, order_date)"
    },
    {
        kind: "check", table: "orders", name: "chk_orders_total",
        sql: "ALTER TABLE orders ADD CONSTRAINT chk_orders_total CHECK (total_amount >= 0)"
    },
    { kind: "drop_index", table: "orders", name: "idx_orders_user", replacedBy: "idx_orders_user_status_date" },

    /* ---------- order_items ---------- */
    {
        kind: "unique", table: "order_items", name: "uq_items_order_product",
        sql: "ALTER TABLE order_items ADD CONSTRAINT uq_items_order_product UNIQUE (order_id, product_id)",
        hint: "An order contains the same product twice. Merge those lines, then run setup-db again."
    },
    {
        kind: "check", table: "order_items", name: "chk_items_quantity",
        sql: "ALTER TABLE order_items ADD CONSTRAINT chk_items_quantity CHECK (quantity > 0)"
    },
    {
        kind: "check", table: "order_items", name: "chk_items_price",
        sql: "ALTER TABLE order_items ADD CONSTRAINT chk_items_price CHECK (unit_price >= 0)"
    },
    { kind: "drop_index", table: "order_items", name: "idx_items_order", replacedBy: "uq_items_order_product" },

    /* ---------- payments ---------- */
    {
        kind: "index", table: "payments", name: "idx_payments_status",
        sql: "CREATE INDEX idx_payments_status ON payments (payment_status)"
    },
    {
        kind: "check", table: "payments", name: "chk_payments_amount",
        sql: "ALTER TABLE payments ADD CONSTRAINT chk_payments_amount CHECK (amount >= 0)"
    },

    /* ---------- audit history for orders that existed BEFORE the triggers ---------- */
    {
        kind: "always", name: "backfill order_status_history",
        sql: `INSERT INTO order_status_history (order_id, old_status, new_status)
              SELECT o.order_id, NULL, o.status
                FROM orders o
               WHERE NOT EXISTS (SELECT 1 FROM order_status_history h WHERE h.order_id = o.order_id)`
    }
];
