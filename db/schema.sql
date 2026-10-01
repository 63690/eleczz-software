-- =====================================================================
-- ELECZZ Software - MySQL schema  (version 2)
--
-- Run with:  npm run setup-db      (safe to run again, never drops data)
--
-- What this file demonstrates:
--   * 7 normalized tables with PRIMARY KEY / FOREIGN KEY relationships
--   * NOT NULL, UNIQUE and CHECK constraints
--   * Indexes chosen for the reporting queries in /sql
--
-- Requires MySQL 8.0.18 or newer (CHECK constraints need 8.0.16+; EXPLAIN ANALYZE in sql/08 needs 8.0.18+).
-- =====================================================================

CREATE DATABASE IF NOT EXISTS eleczz
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE eleczz;

-- ---------------------------------------------------------------------
-- USERS  (one row per registered account / workspace)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    user_id        INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    name           VARCHAR(120)  NOT NULL,
    email          VARCHAR(190)  NOT NULL,
    phone          VARCHAR(30)   NOT NULL,
    company        VARCHAR(160)  NOT NULL,
    password_hash  VARCHAR(100)  NOT NULL,          -- bcrypt hash, never the real password
    created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- CUSTOMERS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    customer_id    INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    user_id        INT UNSIGNED  NOT NULL,          -- owner workspace
    name           VARCHAR(120)  NOT NULL,
    email          VARCHAR(190)  NOT NULL,
    city           VARCHAR(100)  NOT NULL,
    signup_date    DATE          NOT NULL,
    created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (customer_id),
    -- the same customer email cannot be entered twice inside one account
    UNIQUE KEY uq_customers_user_email (user_id, email),
    KEY idx_customers_user_city (user_id, city),
    CONSTRAINT chk_customers_email CHECK (email LIKE '%@%.%'),
    CONSTRAINT fk_customers_user
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- PRODUCTS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    product_id     INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    user_id        INT UNSIGNED  NOT NULL,
    product_name   VARCHAR(160)  NOT NULL,
    category       VARCHAR(100)  NOT NULL,
    price          DECIMAL(12,2) NOT NULL,
    stock          INT UNSIGNED  NOT NULL DEFAULT 0,    -- UNSIGNED: can never go negative
    created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (product_id),
    KEY idx_products_user_category (user_id, category),
    CONSTRAINT chk_products_price CHECK (price >= 0),
    CONSTRAINT fk_products_user
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- ORDERS   (numbering starts at 1001, like the original frontend)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    order_id       INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    user_id        INT UNSIGNED  NOT NULL,
    customer_id    INT UNSIGNED  NOT NULL,
    order_date     DATE          NOT NULL,
    status         ENUM('PENDING','PROCESSING','COMPLETED','CANCELLED')
                                 NOT NULL DEFAULT 'PENDING',
    total_amount   DECIMAL(14,2) NOT NULL,
    created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (order_id),
    KEY idx_orders_customer (customer_id),
    -- serves: "this user's COMPLETED orders in a date range" (dashboard + reports)
    KEY idx_orders_user_status_date (user_id, status, order_date),
    -- serves: cross-account reports such as revenue by month for all data
    KEY idx_orders_status_date (status, order_date),
    CONSTRAINT chk_orders_total CHECK (total_amount >= 0),
    CONSTRAINT fk_orders_user
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
    -- RESTRICT: the database itself refuses to delete a customer who has orders
    CONSTRAINT fk_orders_customer
        FOREIGN KEY (customer_id) REFERENCES customers (customer_id) ON DELETE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=1001;

-- ---------------------------------------------------------------------
-- ORDER ITEMS   (an order can contain several different products)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
    order_item_id  INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    order_id       INT UNSIGNED  NOT NULL,
    product_id     INT UNSIGNED  NOT NULL,
    quantity       INT UNSIGNED  NOT NULL,
    unit_price     DECIMAL(12,2) NOT NULL,          -- price at the time of the order
    PRIMARY KEY (order_item_id),
    -- one line per product per order (also indexes order_id for the foreign key)
    UNIQUE KEY uq_items_order_product (order_id, product_id),
    KEY idx_items_product (product_id),
    CONSTRAINT chk_items_quantity CHECK (quantity > 0),
    CONSTRAINT chk_items_price CHECK (unit_price >= 0),
    CONSTRAINT fk_items_order
        FOREIGN KEY (order_id) REFERENCES orders (order_id) ON DELETE CASCADE,
    CONSTRAINT fk_items_product
        FOREIGN KEY (product_id) REFERENCES products (product_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- PAYMENTS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    payment_id     INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    order_id       INT UNSIGNED  NOT NULL,
    payment_date   DATE          NOT NULL,
    amount         DECIMAL(14,2) NOT NULL,
    payment_status ENUM('PENDING','PAID','REFUNDED') NOT NULL DEFAULT 'PENDING',
    created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (payment_id),
    KEY idx_payments_order (order_id),
    KEY idx_payments_status (payment_status),
    CONSTRAINT chk_payments_amount CHECK (amount >= 0),
    CONSTRAINT fk_payments_order
        FOREIGN KEY (order_id) REFERENCES orders (order_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- ORDER STATUS HISTORY  (audit table - filled automatically by triggers,
-- see sql/07_routines_triggers.sql)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_status_history (
    history_id     INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    order_id       INT UNSIGNED  NOT NULL,
    old_status     ENUM('PENDING','PROCESSING','COMPLETED','CANCELLED') NULL,   -- NULL = order just created
    new_status     ENUM('PENDING','PROCESSING','COMPLETED','CANCELLED') NOT NULL,
    changed_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (history_id),
    KEY idx_history_order (order_id),
    CONSTRAINT fk_history_order
        FOREIGN KEY (order_id) REFERENCES orders (order_id) ON DELETE CASCADE
) ENGINE=InnoDB;
