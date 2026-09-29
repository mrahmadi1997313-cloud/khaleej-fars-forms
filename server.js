const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// -------------------------
// Database
// -------------------------

let pool = null;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
}

async function initializeDatabase() {
  if (!pool) {
    console.log("DATABASE_URL is not configured.");
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS requests (
      id SERIAL PRIMARY KEY,
      tracking_code VARCHAR(50) UNIQUE NOT NULL,
      form_type VARCHAR(50) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'در انتظار بررسی',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      data JSONB NOT NULL
    )
  `);

  console.log("Database initialized successfully.");
}

// -------------------------
// Health
// -------------------------

app.get("/api/health", async (req, res) => {
  let database = "not configured";

  if (pool) {
    try {
      await pool.query("SELECT 1");
      database = "connected";
    } catch (error) {
      database = "error";
    }
  }

  res.json({
    status: "ok",
    database
  });
});

// -------------------------
// Create request
// -------------------------

app.post("/api/requests", async (req, res) => {
  try {
    const { formType, data } = req.body;

    if (!formType || !data) {
      return res.status(400).json({
        success: false,
        message: "اطلاعات فرم ناقص است."
      });
    }

    const trackingCode =
      "GF-" +
      new Date().getFullYear() +
      "-" +
      Math.floor(100000 + Math.random() * 900000);

    if (!pool) {
      return res.status(503).json({
        success: false,
        message: "دیتابیس هنوز متصل نشده است."
      });
    }

    const result = await pool.query(
      `
      INSERT INTO requests
      (tracking_code, form_type, data)
      VALUES ($1, $2, $3)
      RETURNING id, tracking_code, created_at
      `,
      [
        trackingCode,
        formType,
        data
      ]
    );

    res.json({
      success: true,
      id: result.rows[0].id,
      trackingCode: result.rows[0].tracking_code,
      createdAt: result.rows[0].created_at
    });

  } catch (error) {
    console.error("Create request error:", error);

    res.status(500).json({
      success: false,
      message: "خطا در ثبت درخواست."
    });
  }
});

// -------------------------
// Admin authentication
// -------------------------

function adminAuth(req, res, next) {
  const authorization = req.headers.authorization || "";

  const token = authorization.startsWith("Bearer ")
    ? authorization.substring(7)
    : "";

  if (!ADMIN_PASSWORD || token !== ADMIN_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: "دسترسی غیرمجاز."
    });
  }

  next();
}

// -------------------------
// Get admin requests
// -------------------------

app.get(
  "/api/admin/requests",
  adminAuth,
  async (req, res) => {
    try {
      if (!pool) {
        return res.status(503).json({
          success: false,
          message: "دیتابیس متصل نیست."
        });
      }

      const result = await pool.query(`
        SELECT
          id,
          tracking_code,
          form_type,
          status,
          created_at,
          data
        FROM requests
        ORDER BY created_at DESC
      `);

      res.json({
        success: true,
        requests: result.rows
      });

    } catch (error) {
      console.error("Get requests error:", error);

      res.status(500).json({
        success: false,
        message: "خطا در دریافت درخواست‌ها."
      });
    }
  }
);

// -------------------------
// Update status
// -------------------------

app.patch(
  "/api/admin/requests/:id",
  adminAuth,
  async (req, res) => {
    try {
      const { status } = req.body;

      const allowedStatuses = [
        "در انتظار بررسی",
        "تأیید شد",
        "رد شد"
      ];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "وضعیت نامعتبر است."
        });
      }

      if (!pool) {
        return res.status(503).json({
          success: false,
          message: "دیتابیس متصل نیست."
        });
      }

      const result = await pool.query(
        `
        UPDATE requests
        SET status = $1
        WHERE id = $2
        RETURNING *
        `,
        [
          status,
          req.params.id
        ]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          success: false,
          message: "درخواست پیدا نشد."
        });
      }

      res.json({
        success: true,
        request: result.rows[0]
      });

    } catch (error) {
      console.error("Update status error:", error);

      res.status(500).json({
        success: false,
        message: "خطا در تغییر وضعیت."
      });
    }
  }
);

// -------------------------
// Admin dashboard
// -------------------------

app.get("/admin", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="fa" dir="rtl">

<head>
<meta charset="UTF-8">

<meta name="viewport"
content="width=device-width, initial-scale=1.0">

<title>پنل مدیریت | مرکز مبادله هوشمند خلیج فارس</title>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: Tahoma, Arial, sans-serif;
  background: #f1eee8;
  color: #12365f;
}

.container {
  max-width: 1100px;
  margin: auto;
  padding: 25px 15px 50px;
}

.header {
  background: linear-gradient(135deg, #062c59, #14528f);
  color: white;
  border: 2px solid #d5a52c;
  border-radius: 20px;
  padding: 22px;
  text-align: center;
  margin-bottom: 20px;
}

.card {
  background: white;
  border-radius: 18px;
  padding: 20px;
  box-shadow: 0 8px 25px rgba(0,0,0,.12);
  margin-bottom: 20px;
}

input {
  width: 100%;
  padding: 12px;
  border: 1px solid #bbb;
  border-radius: 10px;
  font-family: inherit;
  margin: 8px 0;
}

button {
  border: 0;
  border-radius: 10px;
  padding: 11px 18px;
  color: white;
  background: #073564;
  font-family: inherit;
  cursor: pointer;
  margin: 4px;
}

button.approve {
  background: #198754;
}

button.reject {
  background: #b02a37;
}

.request {
  border: 1px solid #ddd;
  border-radius: 15px;
  padding: 16px;
  margin-top: 15px;
  background: #fafafa;
}

.request-title {
  font-size: 18px;
  font-weight: bold;
  margin-bottom: 10px;
}

.status {
  font-weight: bold;
  margin: 10px 0;
}

.detail {
  margin: 5px 0;
}

.empty {
  text-align: center;
  padding: 30px;
  color: #777;
}

</style>
</head>

<body>

<div class="container">

<div class="header">

<h1>
پنل مدیریت
</h1>

<div>
مرکز مبادله هوشمند خلیج فارس
</div>

</div>

<div class="card">

<h2>
ورود مدیر
</h2>

<input
id="password"
type="password"
placeholder="رمز ورود مدیر"
>

<button onclick="login()">
ورود به پنل
</button>

</div>

<div
id="dashboard"
style="display:none;"
>

<div class="card">

<h2>
درخواست‌های ثبت‌شده
</h2>

<button onclick="loadRequests()">
🔄 به‌روزرسانی
</button>

<div id="requests">
</div>

</div>

</div>

</div>

<script>

let adminToken = "";

function login() {

  const password =
    document.getElementById("password").value.trim();

  if (!password) {
    alert("لطفاً رمز ورود را وارد کنید.");
    return;
  }

  adminToken = password;

  document.getElementById("dashboard").style.display = "block";

  loadRequests();
}

async function loadRequests() {

  try {

    const response = await fetch(
      "/api/admin/requests",
      {
        headers: {
          "Authorization":
            "Bearer " + adminToken
        }
      }
    );

    if (response.status === 401) {
      alert("رمز عبور صحیح نیست.");
      document.getElementById("dashboard").style.display = "none";
      return;
    }

    const result = await response.json();

    if (!result.success) {
      alert(result.message || "خطا در دریافت اطلاعات.");
      return;
    }

    const container =
      document.getElementById("requests");

    container.innerHTML = "";

    if (
      !result.requests ||
      result.requests.length === 0
    ) {

      container.innerHTML =
        '<div class="empty">هنوز درخواستی ثبت نشده است.</div>';

      return;
    }

    result.requests.forEach(request => {

      const data = request.data || {};

      let details = "";

      Object.entries(data).forEach(
        ([key, value]) => {

          details +=
            '<div class="detail">' +
            '<b>' +
            escapeHtml(key) +
            ':</b> ' +
            escapeHtml(String(value ?? "")) +
            '</div>';

        }
      );

      const requestElement =
        document.createElement("div");

      requestElement.className = "request";

      requestElement.innerHTML =

        '<div class="request-title">' +
        '📋 درخواست ' +
        escapeHtml(request.tracking_code) +
        '</div>' +

        '<div class="detail">' +
        '<b>نوع فرم:</b> ' +
        escapeHtml(request.form_type) +
        '</div>' +

        '<div class="detail">' +
        '<b>تاریخ ثبت:</b> ' +
        escapeHtml(
          new Date(request.created_at)
          .toLocaleString("fa-IR")
        ) +
        '</div>' +

        '<div class="status">' +
        '<b>وضعیت:</b> ' +
        escapeHtml(request.status) +
        '</div>' +

        '<hr>' +

        details +

        '<br>' +

        '<button class="approve" ' +
        'onclick="changeStatus(' +
        request.id +
        ', \\'تأیید شد\\')">' +
        '✅ تأیید درخواست' +
        '</button>' +

        '<button class="reject" ' +
        'onclick="changeStatus(' +
        request.id +
        ', \\'رد شد\\')">' +
        '❌ رد درخواست' +
        '</button>';

      container.appendChild(requestElement);

    });

  } catch (error) {

    console.error(error);

    alert("ارتباط با سرور برقرار نشد.");

  }
}

async function changeStatus(id, status) {

  try {

    const response = await fetch(
      "/api/admin/requests/" + id,
      {
        method: "PATCH",

        headers: {
          "Content-Type": "application/json",
          "Authorization":
            "Bearer " + adminToken
        },

        body: JSON.stringify({
          status: status
        })
      }
    );

    const result =
      await response.json();

    if (result.success) {

      loadRequests();

    } else {

      alert(
        result.message ||
        "خطا در تغییر وضعیت."
      );

    }

  } catch (error) {

    console.error(error);

    alert("ارتباط با سرور برقرار نشد.");

  }
}

function escapeHtml(value) {

  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

</script>

</body>
</html>
  `);
});

// -------------------------
// Static files
// -------------------------

app.use(
  express.static(
    path.join(__dirname)
  )
);

// -------------------------
// Start
// -------------------------

async function start() {

  try {

    await initializeDatabase();

    app.listen(
      PORT,
      "0.0.0.0",
      () => {

        console.log(
          "Server running on port " +
          PORT
        );

      }
    );

  } catch (error) {

    console.error(
      "Server startup error:",
      error
    );

    process.exit(1);
  }
}

start();
