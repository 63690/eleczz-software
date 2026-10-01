/* =========================================================
   ELECZZ SOFTWARE
   FRONTEND AUTHENTICATION + BUSINESS ANALYTICS
   ========================================================= */


/* =========================================================
   DATA NOW LIVES IN MYSQL

   Nothing is stored in the browser any more. Every account's
   customers, products, orders, order_items and payments are
   saved in the MySQL database by the Node/Express server
   (server.js -> /api/...).

   The `data` object below is only a temporary in-memory copy
   of what the server returned, so every render function keeps
   working exactly as before.
   ========================================================= */


function createEmptyAnalytics() {

    return {

        kpis: {

            total_revenue: 0,
            completed_orders: 0,
            average_order_value: 0,
            customer_count: 0,
            product_count: 0,
            repeat_customers: 0

        },

        monthly_revenue: [],

        order_status: [],

        top_products: [],

        top_customers: [],

        category_performance: [],

        customer_segments: [],

        idle_customers: [],

        unsold_products: []

    };

}


function createEmptyData() {

    return {

        customers: [],

        products: [],

        orders: [],

        order_items: [],

        payments: [],

        analytics: createEmptyAnalytics()

    };

}


/* =========================================================
   API HELPER

   api("POST", "/api/customers", { ... })
   - sends JSON to the server (login cookie is sent automatically)
   - returns the JSON reply
   - throws an Error whose message is safe to show to the user
   ========================================================= */

async function api(method, url, body) {

    const options = {

        method: method,

        credentials: "same-origin",

        headers: {}

    };


    if (body !== undefined) {

        options.headers["Content-Type"] =
            "application/json";

        options.body =
            JSON.stringify(body);

    }


    let response;

    try {

        response =
            await fetch(url, options);

    }

    catch (networkError) {

        throw new Error(
            "Cannot reach the server. Please check that it is running."
        );

    }


    let payload = null;

    try {

        payload =
            await response.json();

    }

    catch (parseError) {

        payload = null;

    }


    if (!response.ok) {

        /* logged out (cookie expired) while using the app */

        if (
            response.status === 401 &&
            !url.startsWith("/api/auth/")
        ) {

            sessionExpired();

        }


        const error = new Error(
            (payload && payload.error) ||
            "Request failed (" +
                response.status +
                ")."
        );

        error.status =
            response.status;

        throw error;

    }


    return payload;

}


/* =========================================================
   FORM LOCK

   Disables the submit button while the request is running,
   so a double-click can never create a record twice.
   ========================================================= */

function lockForm(event) {

    const button =
        event.submitter ||
        event.target.querySelector(
            'button[type="submit"]'
        );


    if (button) {

        button.disabled = true;

    }


    return function unlock() {

        if (button) {

            button.disabled = false;

        }

    };

}


/* =========================================================
   CURRENT DATA
   ========================================================= */

let data =
    createEmptyData();


let currentUser =
    null;


/* Re-download everything this user owns from MySQL. */

async function refreshData() {

    data =
        await api(
            "GET",
            "/api/data"
        );

}


function sessionExpired() {

    if (!currentUser) {

        return;

    }


    currentUser =
        null;

    data =
        createEmptyData();

    showAuth();

    showToast(
        "Your session has expired. Please sign in again."
    );

}


/* =========================================================
   LOAD SESSION
   Runs on every page load: asks the server "am I still
   logged in?" and, if so, loads the data from MySQL.
   ========================================================= */

async function loadSession() {

    try {

        const result =
            await api(
                "GET",
                "/api/auth/me"
            );

        currentUser =
            result.user;

        await refreshData();

        showApplication();

    }

    catch (error) {

        currentUser =
            null;

        data =
            createEmptyData();

        showAuth();

        if (error.status !== 401) {

            showToast(
                error.message
            );

        }

    }

}


/* =========================================================
   AUTH SCREEN
   ========================================================= */

const authScreen =
    document.getElementById(
        "authScreen"
    );


const application =
    document.getElementById(
        "application"
    );


function showAuth() {

    authScreen.classList.remove(
        "hidden"
    );

    application.classList.add(
        "hidden"
    );

}


function showApplication() {

    authScreen.classList.add(
        "hidden"
    );

    application.classList.remove(
        "hidden"
    );


    updateUserInterface();

    renderDashboard();

    renderOrders();

    renderCustomers();

    renderProducts();

    renderPayments();

}


/* =========================================================
   SHOW LOGIN / SIGNUP
   ========================================================= */

document
    .getElementById(
        "showSignup"
    )
    .addEventListener(
        "click",
        function() {

            document
                .getElementById(
                    "loginBox"
                )
                .classList.add(
                    "hidden"
                );


            document
                .getElementById(
                    "signupBox"
                )
                .classList.remove(
                    "hidden"
                );

        }
    );


document
    .getElementById(
        "showLogin"
    )
    .addEventListener(
        "click",
        function() {

            document
                .getElementById(
                    "signupBox"
                )
                .classList.add(
                    "hidden"
                );


            document
                .getElementById(
                    "loginBox"
                )
                .classList.remove(
                    "hidden"
                );

        }
    );


/* =========================================================
   SIGN UP
   ========================================================= */

document
    .getElementById(
        "signupForm"
    )
    .addEventListener(
        "submit",
        async function(event) {

            event.preventDefault();


            const name =
                document.getElementById(
                    "signupName"
                ).value.trim();


            const email =
                document.getElementById(
                    "signupEmail"
                ).value.trim()
                .toLowerCase();


            const phone =
                document.getElementById(
                    "signupPhone"
                ).value.trim();


            const company =
                document.getElementById(
                    "signupCompany"
                ).value.trim();


            const password =
                document.getElementById(
                    "signupPassword"
                ).value;


            const confirmPassword =
                document.getElementById(
                    "signupConfirmPassword"
                ).value;


            /* PASSWORD CHECK */

            if (
                password !==
                confirmPassword
            ) {

                showToast(
                    "Passwords do not match."
                );

                return;

            }


            /* CREATE THE ACCOUNT IN MYSQL (password is hashed on the server) */

            const unlock =
                lockForm(event);

            try {

                const result =
                    await api(
                        "POST",
                        "/api/auth/signup",
                        {
                            name: name,
                            email: email,
                            phone: phone,
                            company: company,
                            password: password
                        }
                    );

                currentUser =
                    result.user;

                data =
                    createEmptyData();

            }

            catch (error) {

                unlock();

                showToast(
                    error.message
                );

                return;

            }


            unlock();


            document
                .getElementById(
                    "signupForm"
                )
                .reset();


            showApplication();


            showToast(
                "Account created successfully. Your workspace starts at zero."
            );

        }
    );


/* =========================================================
   LOGIN
   ========================================================= */

document
    .getElementById(
        "loginForm"
    )
    .addEventListener(
        "submit",
        async function(event) {

            event.preventDefault();


            const email =
                document.getElementById(
                    "loginEmail"
                ).value
                .trim()
                .toLowerCase();


            const password =
                document.getElementById(
                    "loginPassword"
                ).value;


            const unlock =
                lockForm(event);

            try {

                const result =
                    await api(
                        "POST",
                        "/api/auth/login",
                        {
                            email: email,
                            password: password
                        }
                    );

                currentUser =
                    result.user;

                await refreshData();

            }

            catch (error) {

                unlock();

                currentUser =
                    null;

                showToast(
                    error.message
                );

                return;

            }


            unlock();


            document
                .getElementById(
                    "loginForm"
                )
                .reset();


            showApplication();


            showToast(
                "Welcome back to ELECZZ Software."
            );

        }
    );


/* =========================================================
   LOGOUT
   ========================================================= */

document
    .getElementById(
        "logoutButton"
    )
    .addEventListener(
        "click",
        async function() {

            try {

                await api(
                    "POST",
                    "/api/auth/logout"
                );

            }

            catch (error) {

                /* even if the request fails, sign out on this screen */

            }


            currentUser =
                null;


            data =
                createEmptyData();


            showAuth();


            showToast(
                "You have been signed out."
            );

        }
    );


/* =========================================================
   USER UI
   ========================================================= */

function updateUserInterface() {

    if (!currentUser) {

        return;

    }


    document.getElementById(
        "userName"
    ).textContent =
        currentUser.name;


    document.getElementById(
        "userCompany"
    ).textContent =
        currentUser.company;


    const initials =
        currentUser.name
            .split(" ")
            .map(
                word =>
                    word[0]
            )
            .join("")
            .substring(0, 2)
            .toUpperCase();


    document.getElementById(
        "userAvatar"
    ).textContent =
        initials;

}


/* (Removed: saveData() - every change is now saved to MySQL
   through the API call inside its own handler.) */


/* =========================================================
   NAVIGATION
   ========================================================= */

document
    .querySelectorAll(
        ".nav-btn"
    )
    .forEach(
        button => {

            button.addEventListener(
                "click",
                function() {

                    navigateTo(
                        button.dataset.page
                    );

                }
            );

        }
    );


function navigateTo(page) {

    document
        .querySelectorAll(
            ".nav-btn"
        )
        .forEach(
            button => {

                button.classList.toggle(
                    "active",
                    button.dataset.page ===
                        page
                );

            }
        );


    document
        .querySelectorAll(
            ".page"
        )
        .forEach(
            section => {

                section.classList.toggle(
                    "active",
                    section.id ===
                        page
                );

            }
        );


    const titles = {

        dashboard:
            "Executive Dashboard",

        orders:
            "Order Management",

        customers:
            "Customer Management",

        products:
            "Product Management",

        payments:
            "Payment Management",

        reports:
            "SQL Reports",

        warehouse:
            "Data Warehouse",

        bi:
            "BI Dashboards"

    };


    document.getElementById(
        "pageTitle"
    ).textContent =
        titles[page];


    if (
        page ===
        "dashboard"
    ) {

        renderDashboard();

    }


    if (
        page ===
        "orders"
    ) {

        renderOrders();

    }


    if (
        page ===
        "customers"
    ) {

        renderCustomers();

    }


    if (
        page ===
        "products"
    ) {

        renderProducts();

    }


    if (
        page ===
        "payments"
    ) {

        renderPayments();

    }


    if (
        page ===
        "reports"
    ) {

        renderReports();

    }


    if (
        page ===
        "warehouse"
    ) {

        loadWarehousePage();

    }


    if (
        page ===
        "bi"
    ) {

        loadBIPage();

    }

}


/* =========================================================
   CURRENCY
   ========================================================= */

function formatCurrency(
    value
) {

    return new Intl.NumberFormat(
        "en-IN",
        {

            style: "currency",

            currency: "INR",

            maximumFractionDigits: 0

        }
    ).format(
        value || 0
    );

}


/* =========================================================
   HTML ESCAPE
   ========================================================= */

function escapeHTML(
    value
) {

    return String(
        value ?? ""
    )
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );

}


/* =========================================================
   DASHBOARD NUMBERS COME FROM MYSQL

   Revenue, average order value, repeat customers, monthly
   revenue, top products and the customer ranking are no longer
   calculated in JavaScript. MySQL calculates them in the views
   (sql/05_views.sql) and the server sends the finished numbers
   inside data.analytics.
   ========================================================= */


/* =========================================================
   DASHBOARD
   ========================================================= */

let revenueChart =
    null;


let statusChart =
    null;


function renderDashboard() {

    if (!currentUser) {

        return;

    }


    /* every number below was calculated by MySQL (view v_dashboard_kpis) */

    const kpis =
        data.analytics.kpis;


    document.getElementById(
        "totalRevenue"
    ).textContent =
        formatCurrency(
            kpis.total_revenue
        );


    document.getElementById(
        "orderVolume"
    ).textContent =
        kpis.completed_orders;


    document.getElementById(
        "averageOrder"
    ).textContent =
        formatCurrency(
            kpis.average_order_value
        );


    document.getElementById(
        "customerCount"
    ).textContent =
        kpis.customer_count;


    document.getElementById(
        "productCount"
    ).textContent =
        kpis.product_count;


    document.getElementById(
        "repeatCustomers"
    ).textContent =
        kpis.repeat_customers;


    renderMonthlyRevenue();

    renderOrderStatus();

    renderTopProducts();

    renderCustomerRanking();

}


/* =========================================================
   MONTHLY REVENUE
   ========================================================= */

function renderMonthlyRevenue() {

/* view v_monthly_revenue (GROUP BY month) */

    const months =
        data.analytics.monthly_revenue
            .map(
                row =>
                    row.sales_month
            );


    const values =
        data.analytics.monthly_revenue
            .map(
                row =>
                    row.revenue
            );


    const canvas =
        document.getElementById(
            "revenueChart"
        );


    if (revenueChart) {

        revenueChart.destroy();

    }


    revenueChart =
        new Chart(
            canvas,
            {

                type:
                    "line",

                data: {

                    labels:
                        months,

                    datasets: [

                        {

                            label:
                                "Revenue",

                            data:
                                values,

                            borderColor:
                                "#d71920",

                            backgroundColor:
                                "rgba(215,25,32,0.08)",

                            fill:
                                true,

                            borderWidth:
                                2,

                            tension:
                                .35,

                            pointRadius:
                                4,

                            pointBackgroundColor:
                                "#d71920"

                        }

                    ]

                },

                options: {

                    responsive:
                        true,

                    maintainAspectRatio:
                        false,

                    plugins: {

                        legend: {

                            display:
                                false

                        }

                    },

                    scales: {

                        y: {

                            beginAtZero:
                                true,

                            ticks: {

                                callback:
                                    value =>
                                        "₹" +
                                        Number(
                                            value
                                        ).toLocaleString(
                                            "en-IN"
                                        )

                            }

                        }

                    }

                }

            }
        );

}


/* =========================================================
   ORDER STATUS
   ========================================================= */

function renderOrderStatus() {

/* view v_order_status_summary (GROUP BY status) */

    const statuses = {

        COMPLETED:
            0,

        PROCESSING:
            0,

        PENDING:
            0,

        CANCELLED:
            0

    };


    data.analytics.order_status
        .forEach(
            row => {

                if (
                    statuses[
                        row.status
                    ] !== undefined
                ) {

                    statuses[
                        row.status
                    ] =
                        row.order_count;

                }

            }
        );


    const canvas =
        document.getElementById(
            "statusChart"
        );


    if (statusChart) {

        statusChart.destroy();

    }


    statusChart =
        new Chart(
            canvas,
            {

                type:
                    "doughnut",

                data: {

                    labels:
                        Object.keys(
                            statuses
                        ),

                    datasets: [

                        {

                            data:
                                Object.values(
                                    statuses
                                ),

                            backgroundColor: [

                                "#d71920",

                                "#f05a5f",

                                "#f7a6a8",

                                "#e9d2d2"

                            ],

                            borderWidth:
                                0

                        }

                    ]

                },

                options: {

                    responsive:
                        true,

                    maintainAspectRatio:
                        false,

                    cutout:
                        "68%",

                    plugins: {

                        legend: {

                            position:
                                "bottom",

                            labels: {

                                boxWidth:
                                    10,

                                font: {

                                    size:
                                        9

                                }

                            }

                        }

                    }

                }

            }
        );

}


/* =========================================================
   TOP PRODUCTS
   ========================================================= */

function renderTopProducts() {

/* view v_product_performance (JOIN + SUM + RANK) - top 5 */

    const products =
        data.analytics.top_products
            .map(
                row => ({

                    name:
                        row.product_name,

                    units:
                        row.units_sold,

                    revenue:
                        row.revenue

                })
            );


    const table =
        document.getElementById(
            "topProductsTable"
        );


    if (!products.length) {

        table.innerHTML = `

            <tr>

                <td colspan="4">

                    No sales data available yet.

                </td>

            </tr>

        `;

        return;

    }


    table.innerHTML =
        products.map(
            (
                product,
                index
            ) => `

            <tr>

                <td>
                    ${index + 1}
                </td>

                <td>
                    ${escapeHTML(
                        product.name
                    )}
                </td>

                <td>
                    ${product.units}
                </td>

                <td class="money">

                    ${formatCurrency(
                        product.revenue
                    )}

                </td>

            </tr>

        `
        ).join("");

}


/* =========================================================
   CUSTOMER RANKING
   ========================================================= */

function renderCustomerRanking() {

/* view v_customer_performance (JOIN + SUM + RANK) - top 5 */

    const ranking =
        data.analytics.top_customers
            .map(
                row => ({

                    name:
                        row.name,

                    revenue:
                        row.revenue

                })
            );


    const table =
        document.getElementById(
            "customerRankingTable"
        );


    if (!ranking.length) {

        table.innerHTML = `

            <tr>

                <td colspan="3">

                    No customer revenue data yet.

                </td>

            </tr>

        `;

        return;

    }


    table.innerHTML =
        ranking.map(
            (
                customer,
                index
            ) => `

            <tr>

                <td>
                    ${index + 1}
                </td>

                <td>
                    ${escapeHTML(
                        customer.name
                    )}
                </td>

                <td class="money">

                    ${formatCurrency(
                        customer.revenue
                    )}

                </td>

            </tr>

        `
        ).join("");

}


/* =========================================================
   SQL REPORTS PAGE
   Every table here is filled from a MySQL view:
   v_monthly_revenue, v_customer_performance, v_product_performance
   ========================================================= */

function formatGrowth(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {

        return "-";

    }


    const sign =
        value > 0
            ? "+"
            : "";


    const css =
        value >= 0
            ? "growth-up"
            : "growth-down";


    return `<span class="${css}">${sign}${Number(value).toFixed(1)}%</span>`;

}


function fillReportTable(
    tableId,
    rows,
    columns,
    emptyText
) {

    const table =
        document.getElementById(
            tableId
        );


    if (!rows.length) {

        table.innerHTML = `
            <tr>
                <td colspan="${columns.length}">
                    ${escapeHTML(emptyText)}
                </td>
            </tr>
        `;

        return;

    }


    table.innerHTML =
        rows.map(
            row => `
                <tr>
                    ${columns.map(
                        column => `
                            <td class="${column.className || ""}">
                                ${column.format(row)}
                            </td>
                        `
                    ).join("")}
                </tr>
            `
        ).join("");

}


function renderReports() {

    if (!currentUser) {

        return;

    }


    const report =
        data.analytics;


    /* running total (SUM OVER) + month-over-month growth (LAG) */

    fillReportTable(
        "reportMonthlyTable",
        report.monthly_revenue,
        [
            { format: row => escapeHTML(row.sales_month) },
            { format: row => row.completed_orders },
            { format: row => formatCurrency(row.revenue), className: "money" },
            { format: row => formatCurrency(row.avg_order_value), className: "money" },
            { format: row => formatCurrency(row.running_revenue), className: "money" },
            { format: row => formatGrowth(row.mom_growth_pct) }
        ],
        "No completed orders yet."
    );


    /* CASE expression: customer segmentation */

    fillReportTable(
        "reportSegmentTable",
        report.customer_segments,
        [
            { format: row => escapeHTML(row.segment) },
            { format: row => row.customers },
            { format: row => formatCurrency(row.revenue), className: "money" },
            { format: row => row.pct_of_revenue === null ? "-" : row.pct_of_revenue + "%" }
        ],
        "No customers yet."
    );


    /* GROUP BY category with % share (window function over an aggregate) */

    fillReportTable(
        "reportCategoryTable",
        report.category_performance,
        [
            { format: row => escapeHTML(row.category) },
            { format: row => row.units_sold },
            { format: row => formatCurrency(row.revenue), className: "money" },
            { format: row => row.pct_of_revenue === null ? "-" : row.pct_of_revenue + "%" }
        ],
        "No products yet."
    );


    /* LEFT JOIN: customers without a completed purchase */

    fillReportTable(
        "reportIdleCustomersTable",
        report.idle_customers,
        [
            { format: row => escapeHTML(row.name) },
            { format: row => escapeHTML(row.city) },
            { format: row => escapeHTML(row.signup_date) }
        ],
        "Every customer has bought something."
    );


    /* LEFT JOIN: products that never sold */

    fillReportTable(
        "reportUnsoldProductsTable",
        report.unsold_products,
        [
            { format: row => escapeHTML(row.product_name) },
            { format: row => escapeHTML(row.category) },
            { format: row => row.stock }
        ],
        "Every product has sold at least once."
    );

}


/* =========================================================
   ORDERS
   ========================================================= */

function renderOrders() {

    const search =
        document.getElementById(
            "orderSearch"
        )?.value
        .toLowerCase() || "";


    const filter =
        document.getElementById(
            "orderFilter"
        )?.value || "ALL";


    const orders =
        data.orders.filter(
            order => {

                const customer =
                    data.customers.find(
                        customer =>
                            customer.customer_id ===
                            order.customer_id
                    );


                const name =
                    customer
                        ? customer.name
                        : "";


                const searchMatch =
                    String(
                        order.order_id
                    ).includes(
                        search
                    ) ||
                    name
                        .toLowerCase()
                        .includes(
                            search
                        );


                const statusMatch =
                    filter === "ALL" ||
                    order.status ===
                        filter;


                return (
                    searchMatch &&
                    statusMatch
                );

            }
        );


    const table =
        document.getElementById(
            "ordersTable"
        );


    if (!orders.length) {

        table.innerHTML = `

            <tr>

                <td colspan="7">

                    No orders found.

                </td>

            </tr>

        `;

        return;

    }


    table.innerHTML =
        orders.map(
            order => {

                const customer =
                    data.customers.find(
                        customer =>
                            customer.customer_id ===
                            order.customer_id
                    );


                const payment =
                    data.payments.find(
                        payment =>
                            payment.order_id ===
                            order.order_id
                    );


                return `

                    <tr>

                        <td>
                            <strong>
                                #${order.order_id}
                            </strong>
                        </td>

                        <td>
                            ${escapeHTML(
                                customer
                                    ? customer.name
                                    : "Unknown"
                            )}
                        </td>

                        <td>
                            ${order.order_date}
                        </td>

                        <td>
                            ${statusBadge(
                                order.status
                            )}
                        </td>

                        <td class="money">

                            ${formatCurrency(
                                order.total_amount
                            )}

                        </td>

                        <td>

                            ${statusBadge(
                                payment
                                    ? payment.payment_status
                                    : "PENDING"
                            )}

                        </td>

                        <td>

                            <button
                                class="edit-button"
                                onclick="changeOrderStatus(
                                    ${order.order_id}
                                )"
                            >

                                Change

                            </button>

                        </td>

                    </tr>

                `;

            }
        ).join("");

}


/* =========================================================
   CHANGE ORDER STATUS
   ========================================================= */

function changeOrderStatus(
    orderID
) {

    const order =
        data.orders.find(
            order =>
                order.order_id ===
                orderID
        );


    if (!order) {

        return;

    }


    openModal(
        "Change Order Status",
        `

        <form
            id="statusForm"
            class="form-grid"
        >

            <div
                class="form-group full"
            >

                <label>
                    Order ID
                </label>

                <input
                    value="#${orderID}"
                    disabled
                >

            </div>


            <div
                class="form-group full"
            >

                <label>
                    Status
                </label>

                <select
                    id="newOrderStatus"
                >

                    <option
                        value="PENDING"
                        ${order.status === "PENDING"
                            ? "selected"
                            : ""}
                    >
                        Pending
                    </option>

                    <option
                        value="PROCESSING"
                        ${order.status === "PROCESSING"
                            ? "selected"
                            : ""}
                    >
                        Processing
                    </option>

                    <option
                        value="COMPLETED"
                        ${order.status === "COMPLETED"
                            ? "selected"
                            : ""}
                    >
                        Completed
                    </option>

                    <option
                        value="CANCELLED"
                        ${order.status === "CANCELLED"
                            ? "selected"
                            : ""}
                    >
                        Cancelled
                    </option>

                </select>

            </div>


            <div
                class="form-actions full"
            >

                <button
                    type="button"
                    class="cancel-button"
                    onclick="closeModal()"
                >
                    Cancel
                </button>

                <button
                    type="submit"
                    class="primary-button"
                >
                    Update
                </button>

            </div>

        </form>

        `
    );


    document
        .getElementById(
            "statusForm"
        )
        .addEventListener(
            "submit",
            async function(event) {

                event.preventDefault();


                const unlock =
                    lockForm(event);

                try {

                    await api(
                        "PUT",
                        "/api/orders/" +
                            orderID +
                            "/status",
                        {
                            status:
                                document.getElementById(
                                    "newOrderStatus"
                                ).value
                        }
                    );

                    await refreshData();

                }

                catch (error) {

                    unlock();

                    showToast(
                        error.message
                    );

                    return;

                }

                closeModal();

                renderOrders();

                renderDashboard();

                renderPayments();

                showToast(
                    "Order status updated."
                );

            }
        );

}


/* =========================================================
   CUSTOMERS
   ========================================================= */

function renderCustomers() {

    const search =
        document.getElementById(
            "customerSearch"
        )?.value
        .toLowerCase() || "";


    const customers =
        data.customers.filter(
            customer =>

                customer.name
                    .toLowerCase()
                    .includes(
                        search
                    ) ||

                customer.email
                    .toLowerCase()
                    .includes(
                        search
                    ) ||

                customer.city
                    .toLowerCase()
                    .includes(
                        search
                    )

        );


    const table =
        document.getElementById(
            "customersTable"
        );


    if (!customers.length) {

        table.innerHTML = `

            <tr>

                <td colspan="6">

                    No customers yet.

                    Click "+ Add Customer"
                    to create your first record.

                </td>

            </tr>

        `;

        return;

    }


    table.innerHTML =
        customers.map(
            customer => `

            <tr>

                <td>
                    ${customer.customer_id}
                </td>

                <td>
                    <strong>
                        ${escapeHTML(
                            customer.name
                        )}
                    </strong>
                </td>

                <td>
                    ${escapeHTML(
                        customer.email
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        customer.city
                    )}
                </td>

                <td>
                    ${customer.signup_date}
                </td>

                <td>

                    <button
                        class="edit-button"
                        onclick="editCustomer(
                            ${customer.customer_id}
                        )"
                    >
                        Edit
                    </button>

                    <button
                        class="delete-button"
                        onclick="deleteCustomer(
                            ${customer.customer_id}
                        )"
                    >
                        Delete
                    </button>

                </td>

            </tr>

        `
        ).join("");

}


/* =========================================================
   ADD CUSTOMER
   ========================================================= */

document
    .getElementById(
        "addCustomerBtn"
    )
    .addEventListener(
        "click",
        addCustomer
    );


function addCustomer() {

    openModal(
        "Add Customer",
        `

        <form
            id="customerForm"
            class="form-grid"
        >

            <div class="form-group">

                <label>
                    Name
                </label>

                <input
                    id="customerName"
                    required
                >

            </div>


            <div class="form-group">

                <label>
                    Email
                </label>

                <input
                    type="email"
                    id="customerEmail"
                    required
                >

            </div>


            <div class="form-group">

                <label>
                    City
                </label>

                <input
                    id="customerCity"
                    required
                >

            </div>


            <div class="form-group">

                <label>
                    Signup Date
                </label>

                <input
                    type="date"
                    id="customerDate"
                    required
                >

            </div>


            <div
                class="form-actions full"
            >

                <button
                    type="button"
                    class="cancel-button"
                    onclick="closeModal()"
                >
                    Cancel
                </button>

                <button
                    type="submit"
                    class="primary-button"
                >
                    Add Customer
                </button>

            </div>

        </form>

        `
    );


    document
        .getElementById(
            "customerForm"
        )
        .addEventListener(
            "submit",
            async function(event) {

                event.preventDefault();


                const unlock =
                    lockForm(event);

                try {

                    await api(
                        "POST",
                        "/api/customers",
                        {
                            name:
                                document.getElementById(
                                    "customerName"
                                ).value.trim(),

                            email:
                                document.getElementById(
                                    "customerEmail"
                                ).value.trim(),

                            city:
                                document.getElementById(
                                    "customerCity"
                                ).value.trim(),

                            signup_date:
                                document.getElementById(
                                    "customerDate"
                                ).value
                        }
                    );

                    await refreshData();

                }

                catch (error) {

                    unlock();

                    showToast(
                        error.message
                    );

                    return;

                }

                closeModal();

                renderCustomers();

                renderDashboard();

                showToast(
                    "Customer added successfully."
                );

            }
        );

}


/* =========================================================
   EDIT CUSTOMER
   ========================================================= */

function editCustomer(
    customerID
) {

    const customer =
        data.customers.find(
            customer =>
                customer.customer_id ===
                customerID
        );


    if (!customer) {

        return;

    }


    openModal(
        "Edit Customer",
        `

        <form
            id="editCustomerForm"
            class="form-grid"
        >

            <div class="form-group">

                <label>
                    Name
                </label>

                <input
                    id="editCustomerName"
                    value="${escapeHTML(
                        customer.name
                    )}"
                    required
                >

            </div>


            <div class="form-group">

                <label>
                    Email
                </label>

                <input
                    type="email"
                    id="editCustomerEmail"
                    value="${escapeHTML(
                        customer.email
                    )}"
                    required
                >

            </div>


            <div class="form-group">

                <label>
                    City
                </label>

                <input
                    id="editCustomerCity"
                    value="${escapeHTML(
                        customer.city
                    )}"
                    required
                >

            </div>


            <div class="form-group">

                <label>
                    Signup Date
                </label>

                <input
                    type="date"
                    id="editCustomerDate"
                    value="${customer.signup_date}"
                    required
                >

            </div>


            <div
                class="form-actions full"
            >

                <button
                    type="button"
                    class="cancel-button"
                    onclick="closeModal()"
                >
                    Cancel
                </button>

                <button
                    type="submit"
                    class="primary-button"
                >
                    Save Changes
                </button>

            </div>

        </form>

        `
    );


    document
        .getElementById(
            "editCustomerForm"
        )
        .addEventListener(
            "submit",
            async function(event) {

                event.preventDefault();


                const unlock =
                    lockForm(event);

                try {

                    await api(
                        "PUT",
                        "/api/customers/" +
                            customerID,
                        {
                            name:
                                document.getElementById(
                                    "editCustomerName"
                                ).value.trim(),

                            email:
                                document.getElementById(
                                    "editCustomerEmail"
                                ).value.trim(),

                            city:
                                document.getElementById(
                                    "editCustomerCity"
                                ).value.trim(),

                            signup_date:
                                document.getElementById(
                                    "editCustomerDate"
                                ).value
                        }
                    );

                    await refreshData();

                }

                catch (error) {

                    unlock();

                    showToast(
                        error.message
                    );

                    return;

                }

                closeModal();

                renderCustomers();

                renderDashboard();

                showToast(
                    "Customer updated."
                );

            }
        );

}


/* =========================================================
   DELETE CUSTOMER
   ========================================================= */

async function deleteCustomer(
    customerID
) {

    const hasOrders =
        data.orders.some(
            order =>
                order.customer_id ===
                customerID
        );


    if (hasOrders) {

        showToast(
            "Customer has existing orders and cannot be deleted."
        );

        return;

    }


    if (
        !confirm(
            "Delete this customer?"
        )
    ) {

        return;

    }


    try {

        await api(
            "DELETE",
            "/api/customers/" +
                customerID
        );

        await refreshData();

    }

    catch (error) {

        showToast(
            error.message
        );

        return;

    }

    renderCustomers();

    renderDashboard();

    showToast(
        "Customer deleted."
    );

}


/* =========================================================
   PRODUCTS
   ========================================================= */

function renderProducts() {

    const search =
        document.getElementById(
            "productSearch"
        )?.value
        .toLowerCase() || "";


    const products =
        data.products.filter(
            product =>

                product.product_name
                    .toLowerCase()
                    .includes(
                        search
                    ) ||

                product.category
                    .toLowerCase()
                    .includes(
                        search
                    )

        );


    const table =
        document.getElementById(
            "productsTable"
        );


    if (!products.length) {

        table.innerHTML = `

            <tr>

                <td colspan="6">

                    No products yet.

                    Click "+ Add Product"
                    to create your first record.

                </td>

            </tr>

        `;

        return;

    }


    table.innerHTML =
        products.map(
            product => `

            <tr>

                <td>
                    ${product.product_id}
                </td>

                <td>
                    <strong>
                        ${escapeHTML(
                            product.product_name
                        )}
                    </strong>
                </td>

                <td>
                    ${escapeHTML(
                        product.category
                    )}
                </td>

                <td class="money">

                    ${formatCurrency(
                        product.price
                    )}

                </td>

                <td>
                    ${product.stock}
                </td>

                <td>

                    <button
                        class="edit-button"
                        onclick="editProduct(
                            ${product.product_id}
                        )"
                    >
                        Edit
                    </button>

                    <button
                        class="delete-button"
                        onclick="deleteProduct(
                            ${product.product_id}
                        )"
                    >
                        Delete
                    </button>

                </td>

            </tr>

        `
        ).join("");

}


/* =========================================================
   ADD PRODUCT
   ========================================================= */

document
    .getElementById(
        "addProductBtn"
    )
    .addEventListener(
        "click",
        addProduct
    );


function addProduct() {

    openModal(
        "Add Product",
        `

        <form
            id="productForm"
            class="form-grid"
        >

            <div
                class="form-group full"
            >

                <label>
                    Product Name
                </label>

                <input
                    id="productName"
                    required
                >

            </div>


            <div class="form-group">

                <label>
                    Category
                </label>

                <input
                    id="productCategory"
                    required
                >

            </div>


            <div class="form-group">

                <label>
                    Price
                </label>

                <input
                    type="number"
                    id="productPrice"
                    min="0"
                    step="0.01"
                    required
                >

            </div>


            <div class="form-group">

                <label>
                    Stock
                </label>

                <input
                    type="number"
                    id="productStock"
                    min="0"
                    required
                >

            </div>


            <div
                class="form-actions full"
            >

                <button
                    type="button"
                    class="cancel-button"
                    onclick="closeModal()"
                >
                    Cancel
                </button>

                <button
                    type="submit"
                    class="primary-button"
                >
                    Add Product
                </button>

            </div>

        </form>

        `
    );


    document
        .getElementById(
            "productForm"
        )
        .addEventListener(
            "submit",
            async function(event) {

                event.preventDefault();


                const unlock =
                    lockForm(event);

                try {

                    await api(
                        "POST",
                        "/api/products",
                        {
                            product_name:
                                document.getElementById(
                                    "productName"
                                ).value.trim(),

                            category:
                                document.getElementById(
                                    "productCategory"
                                ).value.trim(),

                            price:
                                Number(
                                    document.getElementById(
                                        "productPrice"
                                    ).value
                                ),

                            stock:
                                Number(
                                    document.getElementById(
                                        "productStock"
                                    ).value
                                )
                        }
                    );

                    await refreshData();

                }

                catch (error) {

                    unlock();

                    showToast(
                        error.message
                    );

                    return;

                }

                closeModal();

                renderProducts();

                renderDashboard();

                showToast(
                    "Product added successfully."
                );

            }
        );

}


/* =========================================================
   EDIT PRODUCT
   ========================================================= */

function editProduct(
    productID
) {

    const product =
        data.products.find(
            product =>
                product.product_id ===
                productID
        );


    if (!product) {

        return;

    }


    openModal(
        "Edit Product",
        `

        <form
            id="editProductForm"
            class="form-grid"
        >

            <div
                class="form-group full"
            >

                <label>
                    Product Name
                </label>

                <input
                    id="editProductName"
                    value="${escapeHTML(
                        product.product_name
                    )}"
                    required
                >

            </div>


            <div class="form-group">

                <label>
                    Category
                </label>

                <input
                    id="editProductCategory"
                    value="${escapeHTML(
                        product.category
                    )}"
                    required
                >

            </div>


            <div class="form-group">

                <label>
                    Price
                </label>

                <input
                    type="number"
                    id="editProductPrice"
                    value="${product.price}"
                    min="0"
                    step="0.01"
                    required
                >

            </div>


            <div class="form-group">

                <label>
                    Stock
                </label>

                <input
                    type="number"
                    id="editProductStock"
                    value="${product.stock}"
                    min="0"
                    required
                >

            </div>


            <div
                class="form-actions full"
            >

                <button
                    type="button"
                    class="cancel-button"
                    onclick="closeModal()"
                >
                    Cancel
                </button>

                <button
                    type="submit"
                    class="primary-button"
                >
                    Save Changes
                </button>

            </div>

        </form>

        `
    );


    document
        .getElementById(
            "editProductForm"
        )
        .addEventListener(
            "submit",
            async function(event) {

                event.preventDefault();


                const unlock =
                    lockForm(event);

                try {

                    await api(
                        "PUT",
                        "/api/products/" +
                            productID,
                        {
                            product_name:
                                document.getElementById(
                                    "editProductName"
                                ).value.trim(),

                            category:
                                document.getElementById(
                                    "editProductCategory"
                                ).value.trim(),

                            price:
                                Number(
                                    document.getElementById(
                                        "editProductPrice"
                                    ).value
                                ),

                            stock:
                                Number(
                                    document.getElementById(
                                        "editProductStock"
                                    ).value
                                )
                        }
                    );

                    await refreshData();

                }

                catch (error) {

                    unlock();

                    showToast(
                        error.message
                    );

                    return;

                }

                closeModal();

                renderProducts();

                renderDashboard();

                showToast(
                    "Product updated."
                );

            }
        );

}


/* =========================================================
   DELETE PRODUCT
   ========================================================= */

async function deleteProduct(
    productID
) {

    const used =
        data.order_items.some(
            item =>
                item.product_id ===
                productID
        );


    if (used) {

        showToast(
            "Product is used in an order and cannot be deleted."
        );

        return;

    }


    if (
        !confirm(
            "Delete this product?"
        )
    ) {

        return;

    }


    try {

        await api(
            "DELETE",
            "/api/products/" +
                productID
        );

        await refreshData();

    }

    catch (error) {

        showToast(
            error.message
        );

        return;

    }

    renderProducts();

    renderDashboard();

    showToast(
        "Product deleted."
    );

}


/* =========================================================
   NEW ORDER
   ========================================================= */

document
    .getElementById(
        "addOrderBtn"
    )
    .addEventListener(
        "click",
        addOrder
    );


function addOrder() {

    if (
        data.customers.length ===
        0
    ) {

        showToast(
            "Add a customer before creating an order."
        );

        return;

    }


    if (
        data.products.length ===
        0
    ) {

        showToast(
            "Add a product before creating an order."
        );

        return;

    }


    const customers =
        data.customers
            .map(
                customer => `

                <option
                    value="${customer.customer_id}"
                >
                    ${escapeHTML(
                        customer.name
                    )}
                </option>

            `
            )
            .join("");


    const products =
        data.products
            .map(
                product => `

                <option
                    value="${product.product_id}"
                >
                    ${escapeHTML(
                        product.product_name
                    )}
                    — ₹${product.price}
                    — Stock ${product.stock}
                </option>

            `
            )
            .join("");


    openModal(
        "Create New Order",
        `

        <form
            id="orderForm"
            class="form-grid"
        >

            <div
                class="form-group full"
            >

                <label>
                    Customer
                </label>

                <select
                    id="orderCustomer"
                    required
                >

                    ${customers}

                </select>

            </div>


            <div class="form-group">

                <label>
                    Product
                </label>

                <select
                    id="orderProduct"
                    required
                >

                    ${products}

                </select>

            </div>


            <div class="form-group">

                <label>
                    Quantity
                </label>

                <input
                    type="number"
                    id="orderQuantity"
                    value="1"
                    min="1"
                    required
                >

            </div>


            <div class="form-group">

                <label>
                    Order Date
                </label>

                <input
                    type="date"
                    id="orderDate"
                    value="${new Date()
                        .toISOString()
                        .substring(
                            0,
                            10
                        )}"
                    required
                >

            </div>


            <div class="form-group">

                <label>
                    Status
                </label>

                <select
                    id="orderStatus"
                >

                    <option value="COMPLETED">
                        Completed
                    </option>

                    <option value="PROCESSING">
                        Processing
                    </option>

                    <option value="PENDING">
                        Pending
                    </option>

                </select>

            </div>


            <div
                class="form-actions full"
            >

                <button
                    type="button"
                    class="cancel-button"
                    onclick="closeModal()"
                >
                    Cancel
                </button>

                <button
                    type="submit"
                    class="primary-button"
                >
                    Create Order
                </button>

            </div>

        </form>

        `
    );


    document
        .getElementById(
            "orderForm"
        )
        .addEventListener(
            "submit",
            async function(event) {

                event.preventDefault();


                const customerID =
                    Number(
                        document.getElementById(
                            "orderCustomer"
                        ).value
                    );


                const productID =
                    Number(
                        document.getElementById(
                            "orderProduct"
                        ).value
                    );


                const quantity =
                    Number(
                        document.getElementById(
                            "orderQuantity"
                        ).value
                    );


                const product =
                    data.products.find(
                        product =>
                            product.product_id ===
                            productID
                    );


                if (
                    !product
                ) {

                    showToast(
                        "Product not found."
                    );

                    return;

                }


                if (
                    quantity <= 0 ||
                    quantity >
                        product.stock
                ) {

                    showToast(
                        "Insufficient stock."
                    );

                    return;

                }


                /* The SERVER re-checks stock, calculates the total and saves
                   order + item + payment + new stock in ONE transaction. */

                const unlock =
                    lockForm(event);

                try {

                    await api(
                        "POST",
                        "/api/orders",
                        {
                            customer_id:
                                customerID,

                            product_id:
                                productID,

                            quantity:
                                quantity,

                            order_date:
                                document.getElementById(
                                    "orderDate"
                                ).value,

                            status:
                                document.getElementById(
                                    "orderStatus"
                                ).value
                        }
                    );

                    await refreshData();

                }

                catch (error) {

                    unlock();

                    showToast(
                        error.message
                    );

                    return;

                }


                closeModal();

                renderOrders();

                renderProducts();

                renderPayments();

                renderDashboard();

                showToast(
                    "Order created successfully."
                );

            }
        );

}


/* =========================================================
   PAYMENTS
   ========================================================= */

function renderPayments() {

    const table =
        document.getElementById(
            "paymentsTable"
        );


    if (!data.payments.length) {

        table.innerHTML = `

            <tr>

                <td colspan="5">

                    No payments yet.

                    Payments will appear when
                    orders are created.

                </td>

            </tr>

        `;

        return;

    }


    table.innerHTML =
        data.payments.map(
            payment => `

            <tr>

                <td>

                    <strong>
                        #${payment.payment_id}
                    </strong>

                </td>

                <td>
                    #${payment.order_id}
                </td>

                <td>
                    ${payment.payment_date}
                </td>

                <td class="money">

                    ${formatCurrency(
                        payment.amount
                    )}

                </td>

                <td>

                    ${statusBadge(
                        payment.payment_status
                    )}

                </td>

            </tr>

        `
        ).join("");

}


/* =========================================================
   STATUS BADGE
   ========================================================= */

function statusBadge(
    status
) {

    return `

        <span
            class="badge ${String(
                status
            ).toLowerCase()}"
        >

            ${escapeHTML(
                status
            )}

        </span>

    `;

}


/* =========================================================
   MODAL
   ========================================================= */

function openModal(
    title,
    content
) {

    document.getElementById(
        "modalTitle"
    ).textContent =
        title;


    document.getElementById(
        "modalContent"
    ).innerHTML =
        content;


    document.getElementById(
        "modal"
    ).classList.add(
        "show"
    );

}


function closeModal() {

    document.getElementById(
        "modal"
    ).classList.remove(
        "show"
    );

}


document
    .getElementById(
        "closeModal"
    )
    .addEventListener(
        "click",
        closeModal
    );


document
    .getElementById(
        "modal"
    )
    .addEventListener(
        "click",
        function(event) {

            if (
                event.target.id ===
                "modal"
            ) {

                closeModal();

            }

        }
    );


/* =========================================================
   TOAST
   ========================================================= */

function showToast(
    message
) {

    const toast =
        document.getElementById(
            "toast"
        );


    toast.textContent =
        message;


    toast.classList.add(
        "show"
    );


    clearTimeout(
        showToast.timer
    );


    showToast.timer =
        setTimeout(
            function() {

                toast.classList.remove(
                    "show"
                );

            },
            2800
        );

}


/* =========================================================
   SEARCH
   ========================================================= */

document
    .getElementById(
        "orderSearch"
    )
    .addEventListener(
        "input",
        renderOrders
    );


document
    .getElementById(
        "orderFilter"
    )
    .addEventListener(
        "change",
        renderOrders
    );


document
    .getElementById(
        "customerSearch"
    )
    .addEventListener(
        "input",
        renderCustomers
    );


document
    .getElementById(
        "productSearch"
    )
    .addEventListener(
        "input",
        renderProducts
    );


/* =========================================================
   REFRESH
   ========================================================= */

document
    .getElementById(
        "refreshDashboard"
    )
    .addEventListener(
        "click",
        async function() {

            try {

                await refreshData();

            }

            catch (error) {

                showToast(
                    error.message
                );

                return;

            }


            renderDashboard();

            renderOrders();

            renderCustomers();

            renderProducts();

            renderPayments();


            renderReports();


            showToast(
                "Dashboard refreshed from the database."
            );

        }
    );


/* =========================================================
   CSV EXPORT  (works with Power BI Desktop, Excel, Google Sheets)
   ========================================================= */

function rowsToCSV(headers, rows) {

    const escapeCell = value => {
        const text = value === null || value === undefined ? "" : String(value);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const lines = [headers.map(escapeCell).join(",")];
    rows.forEach(row => lines.push(row.map(escapeCell).join(",")));
    return lines.join("\r\n");
}

function downloadCSV(filename, headers, rows) {

    try {

        const csv = rowsToCSV(headers, rows);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = url;
        link.download = filename.endsWith(".csv") ? filename : filename + ".csv";
        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(url), 1000);

    } catch (error) {

        /* jsdom / very old browsers without Blob URL support: fail quietly */
        console.warn("CSV download not supported in this environment:", error.message);

    }

}


/* =========================================================
   DATA WAREHOUSE PAGE
   (star schema, SCD Type 2, partitioning, materialized views, ETL)
   ========================================================= */

let dwOverview = null;
let dwScdReport = null;

async function loadWarehousePage() {

    try {

        [dwOverview, dwScdReport] = await Promise.all([
            api("GET", "/api/warehouse/overview"),
            api("GET", "/api/warehouse/scd-report")
        ]);

    } catch (error) {

        showToast(error.message);
        return;

    }

    renderWarehouseBanner(dwOverview.status);
    renderWarehouseSummary(dwOverview);
    renderWarehouseMvTable(dwOverview.materialized_views);
    renderWarehousePartitions(dwOverview.partitions);
    renderWarehouseRuns(dwOverview.runs);
    renderScdReportTable();
    await renderScdTable();

}

function warehouseBadge(status) {
    const cls = status === "SUCCESS" ? "completed" : status === "FAILED" ? "cancelled" : "pending";
    return `<span class="badge ${cls}">${escapeHTML(status)}</span>`;
}

function renderWarehouseBanner(status) {

    const el = document.getElementById("dwStatusBanner");
    const fresh = !status.stale;
    const when = status.last_success_at ? new Date(status.last_success_at).toLocaleString() : "never";

    el.className = "dw-banner " + (fresh ? "fresh" : "stale");
    el.innerHTML = fresh
        ? `✓ The warehouse is up to date with the live tables.<small>Last successful ETL run: ${escapeHTML(when)}</small>`
        : `⚠ ${status.pending_total} change(s) are waiting to be loaded ` +
          `(${status.pending.orders} order status change(s), ${status.pending.customers} customer change(s), ${status.pending.products} product change(s)).` +
          `<small>Last successful ETL run: ${escapeHTML(when)} &mdash; click "Run ETL Now" to catch up</small>`;

}

function renderWarehouseSummary(overview) {

    const job = overview.event.jobs.find(j => j.name === "ev_nightly_warehouse_refresh");

    const cards = [
        ["Fact Rows (order lines)", overview.fact.rows],
        ["Customer Versions", `${overview.dimensions.customer.versions} total \u00b7 ${overview.dimensions.customer.entities} customers \u00b7 ${overview.dimensions.customer.historical} historical`],
        ["Product Versions", `${overview.dimensions.product.versions} total \u00b7 ${overview.dimensions.product.entities} products \u00b7 ${overview.dimensions.product.historical} historical`],
        ["Nightly Refresh Event", job ? `${job.status} \u00b7 every ${job.every}` : "not scheduled"]
    ];

    document.getElementById("dwSummaryCards").innerHTML = cards.map(([label, value]) => `
        <div class="kpi-card">
            <div class="kpi-heading"><span>${escapeHTML(label.toUpperCase())}</span></div>
            <h3 style="font-size:14px;">${escapeHTML(String(value))}</h3>
        </div>
    `).join("");

}

function renderWarehouseMvTable(mvs) {

    fillReportTable(
        "dwMvTable", mvs,
        [
            { format: row => escapeHTML(row.mv_name) },
            { format: row => row.row_count },
            { format: row => escapeHTML(new Date(row.refreshed_at).toLocaleString()) }
        ],
        "No materialized views yet \u2013 click \"Run ETL Now\"."
    );

}

function renderWarehousePartitions(parts) {

    fillReportTable(
        "dwPartitionTable", parts,
        [
            { format: row => escapeHTML(row.name) },
            { format: row => escapeHTML(row.range) },
            { format: row => row.rows }
        ],
        "No partitions found."
    );

}

function renderWarehouseRuns(runs) {

    fillReportTable(
        "dwRunsTable", runs,
        [
            { format: row => "#" + row.run_id },
            { format: row => escapeHTML(new Date(row.started_at).toLocaleString()) },
            { format: row => warehouseBadge(row.status) },
            { format: row => Math.round(row.duration_ms) + " ms" },
            { format: row => `${row.customers_new + row.products_new} new / ${row.customers_changed + row.products_changed} changed` },
            { format: row => `${row.facts_inserted} in / ${row.facts_updated} upd` }
        ],
        "No ETL runs yet."
    );

}

async function renderScdTable() {

    const kind = document.getElementById("dwScdKind").value;
    let result;

    try {

        result = await api("GET", `/api/warehouse/dimension/${kind}`);

    } catch (error) {

        showToast(error.message);
        return;

    }

    fillReportTable(
        "dwScdTable", result.rows,
        [
            { format: row => row.entity_id },
            { format: row => escapeHTML(row.name) },
            { format: row => "v" + row.version_no },
            { format: row => escapeHTML(String(row.tracked_value)) + (row.extra !== null ? " (" + formatCurrency(row.extra) + ")" : "") },
            { format: row => escapeHTML(row.effective_from) },
            { format: row => row.effective_to === "9999-12-31" ? "current" : escapeHTML(row.effective_to) },
            { format: row => row.is_current ? "\u2713" : "" }
        ],
        "No customers or products have changed history yet \u2013 edit one's city / category / price and run the ETL."
    );

}

function renderScdReportTable() {

    const kind = document.getElementById("dwScdReportKind").value;
    const rows = (dwScdReport && dwScdReport[kind]) || [];

    fillReportTable(
        "dwScdReportTable", rows,
        [
            { format: row => escapeHTML(row.name === null ? "(unknown)" : String(row.name)) },
            { format: row => formatCurrency(row.as_was), className: "money" },
            { format: row => formatCurrency(row.as_is), className: "money" },
            {
                format: row => {
                    if (Math.abs(row.difference) < 0.5) return "\u2013";
                    const cls = row.difference > 0 ? "growth-up" : "growth-down";
                    return `<span class="${cls}">${row.difference > 0 ? "+" : ""}${formatCurrency(row.difference)}</span>`;
                }
            }
        ],
        "No completed orders yet."
    );

}

document.getElementById("dwRunEtl").addEventListener("click", async function() {

    const button = this;
    button.disabled = true;

    try {

        const result = await api("POST", "/api/warehouse/etl");
        showToast(`ETL run #${result.run.run_id} ${result.run.status.toLowerCase()} in ${Math.round(result.run.duration_ms)} ms.`);
        await loadWarehousePage();

    } catch (error) {

        showToast(error.message);

    }

    button.disabled = false;

});

document.getElementById("dwRefreshMv").addEventListener("click", async function() {

    try {

        const result = await api("POST", "/api/warehouse/refresh-mv");
        showToast(`Materialized views rebuilt in ${result.elapsed_ms} ms.`);
        await loadWarehousePage();

    } catch (error) {

        showToast(error.message);

    }

});

document.getElementById("dwScdKind").addEventListener("change", renderScdTable);
document.getElementById("dwScdReportKind").addEventListener("change", renderScdReportTable);

document.getElementById("dwPruneTest").addEventListener("click", async function() {

    const from = document.getElementById("dwPruneFrom").value;
    const to = document.getElementById("dwPruneTo").value;
    const box = document.getElementById("dwPruneResult");

    if (!from || !to) {
        showToast("Choose both dates.");
        return;
    }

    let result;

    try {

        result = await api("GET", `/api/warehouse/pruning?from=${from}&to=${to}`);

    } catch (error) {

        showToast(error.message);
        return;

    }

    box.innerHTML = `
        Read <strong>${result.partitions_read.length} of ${result.partitions_total}</strong> partitions:
        ${result.partitions_read.map(p => `<span class="partition-pill">${escapeHTML(p)}</span>`).join("")}
        <br>${result.lines} order line(s), revenue ${formatCurrency(result.revenue)}
        <code>${escapeHTML(result.sql)}</code>
    `;

});


/* =========================================================
   BI DASHBOARDS  (self-hosted dashboard builder)
   ========================================================= */

let biDatasets = [];
let biCurrentDashboardId = null;
let biCurrentWidgets = [];
const biChartInstances = {};

/* Called when the BI nav page is first opened: closes any open dashboard viewer. */
async function loadBIPage() {

    document.getElementById("biViewer").classList.add("hidden");
    biCurrentDashboardId = null;

    await refreshBIListings();

}

/* Refreshes the template gallery + "my dashboards" table WITHOUT touching
   whichever dashboard is currently open in the viewer (if any). Used after
   generating/saving/deleting a dashboard, so the open viewer is not closed. */
async function refreshBIListings() {

    let templates, dashboards, datasetResult;

    try {

        [templates, dashboards, datasetResult] = await Promise.all([
            api("GET", "/api/bi/templates"),
            api("GET", "/api/bi/dashboards"),
            api("GET", "/api/bi/datasets")
        ]);

    } catch (error) {

        showToast(error.message);
        return;

    }

    biDatasets = datasetResult.datasets;
    renderBITemplates(templates.templates);
    renderBIDashboardsTable(dashboards.dashboards);
    populateBIDatasetSelect();

}

function renderBITemplates(templates) {

    document.getElementById("biTemplates").innerHTML = templates.map(t => `
        <div class="bi-template-card" data-template="${escapeHTML(t.id)}">
            <h4>${escapeHTML(t.name)}</h4>
            <p>${escapeHTML(t.description)}</p>
            <span>${t.widgets} widgets &rarr; generate</span>
        </div>
    `).join("");

    document.querySelectorAll(".bi-template-card").forEach(card => {
        card.addEventListener("click", () => generateDashboardFromTemplate(card.dataset.template));
    });

}

function renderBIDashboardsTable(dashboards) {

    if (!dashboards.length) {
        document.getElementById("biDashboardsTable").innerHTML =
            `<tr><td colspan="4">No dashboards yet \u2013 generate one from a template above, or make a blank one.</td></tr>`;
        return;
    }

    document.getElementById("biDashboardsTable").innerHTML = dashboards.map(d => `
        <tr>
            <td><a href="#" class="bi-open-link" data-id="${d.dashboard_id}">${escapeHTML(d.name)}</a></td>
            <td>${d.widgets}</td>
            <td>${escapeHTML(new Date(d.updated_at).toLocaleString())}</td>
            <td><button class="view-button bi-delete-link" data-id="${d.dashboard_id}">Delete</button></td>
        </tr>
    `).join("");

    document.querySelectorAll(".bi-open-link").forEach(a => {
        a.addEventListener("click", event => {
            event.preventDefault();
            openDashboard(Number(a.dataset.id));
        });
    });

    document.querySelectorAll(".bi-delete-link").forEach(button => {
        button.addEventListener("click", async () => {
            if (!confirm("Delete this dashboard? This cannot be undone.")) return;
            try {
                await api("DELETE", `/api/bi/dashboards/${button.dataset.id}`);
                showToast("Dashboard deleted.");
                await loadBIPage();
            } catch (error) {
                showToast(error.message);
            }
        });
    });

}

async function generateDashboardFromTemplate(templateId) {

    try {

        const result = await api("POST", "/api/bi/dashboards/generate", { template: templateId });
        showToast(`"${result.dashboard.name}" created.`);
        await showDashboard(result.dashboard, result.widgets);
        await refreshBIListings();
        document.getElementById("biViewer").classList.remove("hidden");

    } catch (error) {

        showToast(error.message);

    }

}

document.getElementById("biNewBlank").addEventListener("click", async function() {

    try {

        const result = await api("POST", "/api/bi/dashboards", { name: "New Dashboard", widgets: [] });
        await loadBIPage();
        await showDashboard(result.dashboard, result.widgets);
        document.getElementById("biViewer").classList.remove("hidden");

    } catch (error) {

        showToast(error.message);

    }

});

async function openDashboard(id) {

    try {

        const result = await api("GET", `/api/bi/dashboards/${id}`);
        await showDashboard(result.dashboard, result.widgets);
        document.getElementById("biViewer").classList.remove("hidden");

    } catch (error) {

        showToast(error.message);

    }

}

async function showDashboard(dashboard, widgets) {

    biCurrentDashboardId = dashboard.dashboard_id;
    biCurrentWidgets = widgets.map(w => ({ title: w.title, size: w.size, config: w.config }));

    document.getElementById("biDashName").value = dashboard.name;

    await renderBIWidgets();

}

async function renderBIWidgets() {

    const container = document.getElementById("biWidgets");

    if (!biCurrentWidgets.length) {
        container.innerHTML = `<div class="bi-empty">This dashboard has no widgets yet. Add one below.</div>`;
        return;
    }

    container.innerHTML = biCurrentWidgets.map((w, i) => `
        <div class="bi-widget size-${w.size}" data-index="${i}">
            <div class="bi-widget-header">
                <h4>${escapeHTML(w.title)}</h4>
                <div class="bi-widget-actions">
                    <button class="bi-csv-btn" data-index="${i}" title="Download CSV">\u2b07</button>
                    <button class="bi-remove-btn" data-index="${i}" title="Remove">\u00d7</button>
                </div>
            </div>
            <div class="bi-widget-body ${w.config.chart === "table" || w.config.chart === "kpi" ? "" : "chart"}" id="biWidgetBody${i}"></div>
            <div class="bi-widget-meta" id="biWidgetMeta${i}"></div>
        </div>
    `).join("");

    await Promise.all(biCurrentWidgets.map((w, i) => renderOneWidget(w, i)));

    document.querySelectorAll(".bi-remove-btn").forEach(button => {
        button.addEventListener("click", async () => {
            biCurrentWidgets.splice(Number(button.dataset.index), 1);
            await saveCurrentDashboard();
            await renderBIWidgets();
        });
    });

    document.querySelectorAll(".bi-csv-btn").forEach(button => {
        button.addEventListener("click", () => {
            const w = biCurrentWidgets[Number(button.dataset.index)];
            const last = w.__lastResult;
            if (!last) return;
            const headers = last.columns.map(c => c.label);
            downloadCSV(w.title, headers, last.rows);
        });
    });

}

async function renderOneWidget(widget, index) {

    const body = document.getElementById("biWidgetBody" + index);
    const meta = document.getElementById("biWidgetMeta" + index);
    if (!body) return;

    let result;

    try {

        result = await api("POST", "/api/bi/query", widget.config);

    } catch (error) {

        body.innerHTML = `<div class="bi-empty">${escapeHTML(error.message)}</div>`;
        return;

    }

    widget.__lastResult = result;
    meta.textContent = `${result.source} (${result.source_kind}) \u00b7 ${result.elapsed_ms} ms`;

    if (widget.config.chart === "kpi") {

        const value = result.rows[0] ? result.rows[0][0] : 0;
        const column = result.columns[result.columns.length - 1];
        body.innerHTML = `
            <div class="bi-widget-kpi">
                ${column.format === "currency" ? formatCurrency(value) : (value === null ? "0" : Number(value).toLocaleString())}
                <small>${escapeHTML(column.label)}</small>
            </div>
        `;
        return;

    }

    if (widget.config.chart === "table") {

        body.innerHTML = `
            <div class="table-wrapper">
                <table>
                    <thead><tr>${result.columns.map(c => `<th>${escapeHTML(c.label)}</th>`).join("")}</tr></thead>
                    <tbody>
                        ${result.rows.length
                            ? result.rows.map(row => `<tr>${row.map((v, i) =>
                                `<td>${v === null ? "-" : (result.columns[i].format === "currency" ? formatCurrency(v) : escapeHTML(String(v)))}</td>`
                              ).join("")}</tr>`).join("")
                            : `<tr><td colspan="${result.columns.length}">No data.</td></tr>`}
                    </tbody>
                </table>
            </div>
        `;
        return;

    }

    /* bar / line / pie / doughnut */

    body.innerHTML = `<canvas></canvas>`;
    const canvas = body.querySelector("canvas");

    if (biChartInstances[index]) {
        biChartInstances[index].destroy();
    }

    const labels = result.rows.map(r => r[0] === null ? "(none)" : String(r[0]));
    const values = result.rows.map(r => Number(r[1]) || 0);
    const palette = ["#d71920", "#f2994a", "#2f80ed", "#16834b", "#9b51e0", "#f2c94c", "#56ccf2", "#828282"];

    biChartInstances[index] = new Chart(canvas, {
        type: widget.config.chart === "doughnut" ? "doughnut" : widget.config.chart,        data: {
            labels,
            datasets: [{
                label: result.columns[result.columns.length - 1].label,
                data: values,
                backgroundColor: widget.config.chart === "line" ? "rgba(215,25,32,.12)" : palette,
                borderColor: "#d71920",
                borderWidth: widget.config.chart === "line" ? 2 : 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: ["pie", "doughnut"].includes(widget.config.chart) } }
        }
    });

}

async function saveCurrentDashboard() {

    if (!biCurrentDashboardId) return;

    const name = document.getElementById("biDashName").value.trim() || "Untitled Dashboard";

    try {

        await api("PUT", `/api/bi/dashboards/${biCurrentDashboardId}`, {
            name,
            widgets: biCurrentWidgets.map(w => ({ title: w.title, size: w.size, config: w.config }))
        });

    } catch (error) {

        showToast(error.message);

    }

}

document.getElementById("biSaveDash").addEventListener("click", async function() {

    await saveCurrentDashboard();
    showToast("Dashboard saved.");
    await refreshBIListings();
    document.getElementById("biViewer").classList.remove("hidden");

});

document.getElementById("biCloseDash").addEventListener("click", function() {

    document.getElementById("biViewer").classList.add("hidden");
    biCurrentDashboardId = null;
    biCurrentWidgets = [];

});

document.getElementById("biExportAll").addEventListener("click", function() {

    biCurrentWidgets.forEach(w => {
        if (!w.__lastResult) return;
        downloadCSV(w.title, w.__lastResult.columns.map(c => c.label), w.__lastResult.rows);
    });

});

function populateBIDatasetSelect() {

    const select = document.getElementById("biDataset");
    select.innerHTML = biDatasets.map(d => `<option value="${escapeHTML(d.id)}">${escapeHTML(d.label)}</option>`).join("");
    populateBIFieldSelects();

}

function populateBIFieldSelects() {

    const dataset = biDatasets.find(d => d.id === document.getElementById("biDataset").value);
    if (!dataset) return;

    const chart = document.getElementById("biChart").value;
    const dimensionSelect = document.getElementById("biDimension");
    const measureSelect = document.getElementById("biMeasure");

    dimensionSelect.innerHTML = dataset.dimensions.map(d => `<option value="${escapeHTML(d.id)}">${escapeHTML(d.label)}</option>`).join("");
    dimensionSelect.disabled = chart === "kpi";

    measureSelect.innerHTML = dataset.measures.map(m => `<option value="${escapeHTML(m.id)}">${escapeHTML(m.label)}</option>`).join("");

}

document.getElementById("biDataset").addEventListener("change", populateBIFieldSelects);
document.getElementById("biChart").addEventListener("change", populateBIFieldSelects);

document.getElementById("biAddWidget").addEventListener("click", async function() {

    if (!biCurrentDashboardId) {
        showToast("Open or create a dashboard first.");
        return;
    }

    const chart = document.getElementById("biChart").value;
    const dataset = document.getElementById("biDataset").value;
    const dimension = document.getElementById("biDimension").value;
    const measure = document.getElementById("biMeasure").value;
    const limit = Number(document.getElementById("biLimit").value) || 10;
    const titleInput = document.getElementById("biWidgetTitle").value.trim();

    const datasetInfo = biDatasets.find(d => d.id === dataset);
    const measureInfo = datasetInfo && datasetInfo.measures.find(m => m.id === measure);
    const dimensionInfo = datasetInfo && datasetInfo.dimensions.find(d => d.id === dimension);

    const title = titleInput || `${measureInfo ? measureInfo.label : measure} by ${dimensionInfo ? dimensionInfo.label : "-"}`;

    const config = {
        dataset, chart, measures: [measure], limit,
        dimension: chart === "kpi" ? undefined : dimension
    };

    biCurrentWidgets.push({ title, size: chart === "table" ? "L" : "M", config });

    document.getElementById("biWidgetTitle").value = "";

    await saveCurrentDashboard();
    await renderBIWidgets();
    showToast("Widget added.");

});


/* =========================================================
   VIEW ALL BUTTONS
   ========================================================= */

document
    .querySelectorAll(
        "[data-page-link]"
    )
    .forEach(
        button => {

            button.addEventListener(
                "click",
                function() {

                    navigateTo(
                        button.dataset.pageLink
                    );

                }
            );

        }
    );


/* =========================================================
   INITIAL SESSION
   ========================================================= */

loadSession();