const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 10000;

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || "CHANGE_THIS_PASSWORD";

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

/*
|--------------------------------------------------------------------------
| Database
|--------------------------------------------------------------------------
*/

let pool = null;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
}

/*
|--------------------------------------------------------------------------
| Database initialization
|--------------------------------------------------------------------------
*/

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
      status VARCHAR(30) DEFAULT 'در انتظار بررسی',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      data JSONB NOT NULL
    )
  `);

  console.log("Database initialized.");
}


/*
|--------------------------------------------------------------------------
| Health check
|--------------------------------------------------------------------------
*/

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


/*
|--------------------------------------------------------------------------
| Create request
|--------------------------------------------------------------------------
*/

app.post("/api/requests", async (req, res) => {

  try {

    const {
      formType,
      data
    } = req.body;

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


    /*
     * اگر دیتابیس هنوز متصل نشده باشد،
     * برای تست شماره پیگیری تولید می‌کنیم.
     */

    if (!pool) {

      return res.json({
        success: true,
        trackingCode,
        message: "درخواست دریافت شد."
      });

    }


    const result = await pool.query(
      `
      INSERT INTO requests
      (
        tracking_code,
        form_type,
        data
      )
      VALUES
      ($1, $2, $3)
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
      trackingCode: result.rows[0].tracking_code,
      id: result.rows[0].id
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message: "خطا در ثبت درخواست."
    });

  }

});


/*
|--------------------------------------------------------------------------
| Admin authentication
|--------------------------------------------------------------------------
*/

function adminAuth(req, res, next) {

  const auth =
    req.headers.authorization || "";

  const token =
    auth.replace("Bearer ", "");

  if (
    !token ||
    token !== ADMIN_PASSWORD
  ) {

    return res.status(401).json({
      success: false,
      message: "دسترسی غیرمجاز."
    });

  }

  next();

}


/*
|--------------------------------------------------------------------------
| Get requests
|--------------------------------------------------------------------------
*/

app.get(
  "/api/admin/requests",
  adminAuth,
  async (req, res) => {

    try {

      if (!pool) {

        return res.json({
          success: true,
          requests: []
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

      console.error(error);

      res.status(500).json({
        success: false,
        message: "خطا در دریافت درخواست‌ها."
      });

    }

  }
);


/*
|--------------------------------------------------------------------------
| Update request status
|--------------------------------------------------------------------------
*/

app.patch(
  "/api/admin/requests/:id",
  adminAuth,
  async (req, res) => {

    try {

      const {
        status
      } = req.body;

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

      if (!result.rowCount) {

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

      console.error(error);

      res.status(500).json({
        success: false,
        message: "خطا در تغییر وضعیت."
      });

    }

  }
);


/*
|--------------------------------------------------------------------------
| Admin dashboard
|--------------------------------------------------------------------------
*/

app.get("/admin", adminAuthPage);


/*
|--------------------------------------------------------------------------
| Admin login page
|--------------------------------------------------------------------------
*/

function adminAuthPage(req, res) {

  res.send(`
<!DOCTYPE html>

<html lang="fa" dir="rtl">

<head>

<meta charset="UTF-8">

<meta name="viewport"
content="width=device-width,initial-scale=1">

<title>پنل مدیریت</title>

<style>

body{
margin:0;
font-family:Tahoma,Arial;
background:#f1eee8;
color:#12365f;
}

.box{
max-width:1000px;
margin:30px auto;
padding:20px;
}

.card{
background:white;
border-radius:18px;
padding:20px;
box-shadow:0 8px 25px #0002;
margin-bottom:20px;
}

h1{
color:#073564;
}

input{
padding:12px;
border:1px solid #bbb;
border-radius:10px;
font-family:inherit;
width:100%;
box-sizing:border-box;
margin:8px 0;
}

button{
padding:11px 18px;
border:0;
border-radius:10px;
background:#073564;
color:white;
font-family:inherit;
cursor:pointer;
margin:3px;
}

button.approve{
background:#198754;
}

button.reject{
background:#b02a37;
}

.request{
border:1px solid #ddd;
border-radius:15px;
padding:15px;
margin-top:15px;
}

.status{
font-weight:bold;
}

</style>

</head>

<body>

<div class="box">

<div class="card">

<h1>
پنل مدیریت
</h1>

<input
id="password"
type="password"
placeholder="رمز ورود مدیر"
>

<button onclick="login()">
ورود
</button>

</div>


<div
id="dashboard"
style="display:none"
>

<div class="card">

<h2>
درخواست‌های ثبت شده
</h2>

<button onclick="loadRequests()">
به‌روزرسانی
</button>

<div id="requests">
</div>

</div>

</div>

</div>


<script>

let adminToken = "";


function login(){

adminToken =
document.getElementById(
"password"
).value;

if(!adminToken){

alert("رمز را وارد کنید.");

return;

}

document.getElementById(
"dashboard"
).style.display =
"block";

loadRequests();

}


async function loadRequests(){

const response =
await fetch(
"/api/admin/requests",
{
headers:{
"Authorization":
"Bearer "+adminToken
}
}
);


if(response.status===401){

alert("رمز عبور اشتباه است.");

return;

}


const result =
await response.json();


const container =
document.getElementById(
"requests"
);


container.innerHTML = "";


if(
!result.requests ||
result.requests.length===0
){

container.innerHTML =
"<p>درخواستی ثبت نشده است.</p>";

return;

}


result.requests.forEach(
request => {

const data =
request.data || {};


let details = "";

Object.entries(data)
.forEach(
([key,value]) => {

details +=
"<div><b>"+
key+
":</b> "+
(value || "")+
"</div>";

}
);


container.innerHTML += `

<div class="request">

<div>
<b>شماره پیگیری:</b>
${request.tracking_code}
</div>

<div>
<b>نوع فرم:</b>
${request.form_type}
</div>

<div>
<b>تاریخ ثبت:</b>
${new Date(
request.created_at
).toLocaleString("fa-IR")}
</div>

<div class="status">
<b>وضعیت:</b>
${request.status}
</div>

<hr>

${details}

<br>

<button
class="approve"
onclick="changeStatus(
${request.id},
'تأیید شد'
)">

تأیید درخواست

</button>

<button
class="reject"
onclick="changeStatus(
${request.id},
'رد شد'
)">

رد درخواست

</button>

</div>

`;

});

}


async function changeStatus(
id,
status
){

const response =
await fetch(
"/api/admin/requests/"+id,
{
method:"PATCH",

headers:{
"Content-Type":
"application/json",

"Authorization":
"Bearer "+adminToken
},

body:JSON.stringify({
status:status
})

});


const result =
await response.json();


if(result.success){

loadRequests();

}else{

alert(
result.message ||
"خطا"
);

}

}

</script>

</body>

</html>
`);

}


/*
|--------------------------------------------------------------------------
| Static website
|--------------------------------------------------------------------------
*/

app.use(
express.static(
path.join(__dirname)
)
);


/*
|--------------------------------------------------------------------------
| Start server
|--------------------------------------------------------------------------
*/

async function start(){

try{

await initializeDatabase();

app.listen(
PORT,
"0.0.0.0",
() => {

console.log(
"Server running on port "+
PORT
);

});

}catch(error){

console.error(
"Server startup error:",
error
);

process.exit(1);

}

}

start();
