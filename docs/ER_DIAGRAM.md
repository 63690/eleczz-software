# Data Model / ER Diagram

![ER diagram](er-diagram.png)

*(High-resolution PNG: `er-diagram.png` · editable vector: `er-diagram.svg`. The Mermaid version
below is drawn automatically by GitHub.)*

```mermaid
erDiagram
    users ||--o{ customers : owns
    users ||--o{ products  : owns
    users ||--o{ orders    : owns
    customers ||--o{ orders : places
    orders ||--|{ order_items : contains
    products ||--o{ order_items : "sold in"
    orders ||--o| payments : "paid by"
    orders ||--o{ order_status_history : "audited by trigger"

    users {
        int user_id PK
        varchar name
        varchar email UK
        varchar phone
        varchar company
        varchar password_hash
    }
    customers {
        int customer_id PK
        int user_id FK
        varchar name
        varchar email "UK with user_id"
        varchar city
        date signup_date
    }
    products {
        int product_id PK
        int user_id FK
        varchar product_name
        varchar category
        decimal price "CHECK >= 0"
        int stock
    }
    orders {
        int order_id PK
        int user_id FK
        int customer_id FK
        date order_date
        enum status
        decimal total_amount "CHECK >= 0"
    }
    order_items {
        int order_item_id PK
        int order_id FK
        int product_id FK
        int quantity "CHECK > 0"
        decimal unit_price "CHECK >= 0"
    }
    payments {
        int payment_id PK
        int order_id FK
        date payment_date
        decimal amount "CHECK >= 0"
        enum payment_status
    }
    order_status_history {
        int history_id PK
        int order_id FK
        enum old_status
        enum new_status
        timestamp changed_at
    }
```

## Relationships

| Parent (1) | Child (many) | Meaning | If the parent is deleted |
|---|---|---|---|
| `users` | `customers`, `products`, `orders` | an account owns its data | cascade |
| `customers` | `orders` | a customer places many orders | **restricted** – refused while orders exist |
| `orders` | `order_items` | an order has one or more lines | cascade |
| `products` | `order_items` | a product appears on many lines | **restricted** – refused while sold |
| `orders` | `payments` | an order is paid by a payment | cascade |
| `orders` | `order_status_history` | every status change is logged | cascade |

## Normalization

* **1NF** – every column holds one value; there are no repeating groups (order lines live in their own table).
* **2NF** – in `order_items` every non-key column (`quantity`, `unit_price`) depends on the whole key (order + product).
* **3NF** – customer details are stored once in `customers`, product details once in `products`; orders only
  reference them by ID.

Two deliberate, controlled exceptions, both required by the project brief:

* `orders.total_amount` repeats what could be summed from `order_items`. It is kept for fast reporting, calculated only
  by the server, and `sql/02_joins.sql` (check #6) proves it always equals the sum of the lines.
* `order_items.unit_price` repeats `products.price`. That is intentional: it records the price the customer really
  paid, so a later price change never rewrites past revenue.
