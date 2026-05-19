from flask import Flask, render_template, request, redirect, url_for, session, flash, make_response
from flask_cors import CORS
from flask import Response
import os
import sqlite3
import requests
import threading
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash

# ================= WHATSAPP API CONFIGURATION (STABLE) =================
# This system uses the new Lightweight Baileys Engine on Render.
ADMIN_PHONES = ['918300302815'] 
_BASE_BOT_URL = os.environ.get("WHATSAPP_API_URL", "https://samyuktha-realtime.onrender.com").rstrip("/")
WHATSAPP_API_URL = f"{_BASE_BOT_URL}/api/send-whatsapp"
# ============================================================================

app = Flask(__name__)
CORS(app) 
app.secret_key = "CHANGE_THIS_SECRET_KEY"

DB = "database.db"

def db():
    conn = sqlite3.connect(DB,timeout=10)
    conn.row_factory = sqlite3.Row
    return conn

def send_whatsapp_message(phone, message_body):
    """Sends WhatsApp alert via cloud bot. Long timeout to handle Render cold-start."""
    try:
        payload = {"phone": phone, "message": message_body}
        # 60s timeout: Render free tier can take up to 30s to wake up
        resp = requests.post(WHATSAPP_API_URL, json=payload, timeout=60)
        if resp.status_code == 200:
            print(f"✅ WhatsApp Bot: Sent to {phone}")
            return {"status": "success", "provider": "bot"}
        else:
            print(f"❌ WhatsApp Bot: Bad response {resp.status_code} for {phone}")
            return None
    except Exception as e:
        print(f"❌ WhatsApp Bot: FAILED for {phone}: {e}")
        return None

def notify_admins(message_body):
    """Sends notification to all admins in a BACKGROUND THREAD.
    This ensures the booking page loads instantly, even if the bot is waking up."""
    def _send():
        for phone in ADMIN_PHONES:
            send_whatsapp_message(phone, message_body)
    
    t = threading.Thread(target=_send, daemon=True)
    t.start()
    print(f"DEBUG: Background WhatsApp thread started for {len(ADMIN_PHONES)} admin(s).")


def init_db():
    conn = db()
    cur = conn.cursor()

    cur.execute("""
    CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS drivers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Available'
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS trips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT,
        customer_phone TEXT,
        from_city TEXT NOT NULL,
        to_city TEXT NOT NULL,
        date TEXT NOT NULL,
        vehicle_type TEXT NOT NULL,
        driver_id INTEGER,
        status TEXT NOT NULL DEFAULT 'Active', -- Active / Completed
        km_run REAL NOT NULL DEFAULT 0,
        revenue REAL NOT NULL DEFAULT 0,
        fuel_cost REAL NOT NULL DEFAULT 0,
        other_expense REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY(driver_id) REFERENCES drivers(id)
    )
    """)

    # Create default admin if no admins exist
    cur.execute("SELECT COUNT(*) AS c FROM admins")
    if cur.fetchone()["c"] == 0:
        cur.execute(
            "INSERT INTO admins (username, password_hash) VALUES (?, ?)",
            ("admin", generate_password_hash("admin123"))
        )

    conn.commit()
    conn.close()

init_db()
from flask import Response, make_response, render_template, request, url_for
from datetime import datetime

# ================ PERFORMANCE: CACHING HEADERS ================

@app.after_request
def add_cache_headers(response):
    """Add caching headers"""

    # Static assets (CSS, JS, Images, Fonts)
    if request.path.startswith('/static/'):

        response.headers['Cache-Control'] = (
            'public, max-age=31536000, immutable'
        )

    # SEO files
    elif request.path in ['/sitemap.xml', '/robots.txt']:

        # Always allow fresh fetch by Google
        response.headers['Cache-Control'] = (
            'no-cache, must-revalidate'
        )

    # HTML pages
    else:

        response.headers['Cache-Control'] = (
            'no-cache, no-store, must-revalidate'
        )

        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'

    return response


# ---------------- SITEMAP ----------------

@app.route('/sitemap.xml', methods=['GET'])
def sitemap():

    pages = []
    today = datetime.utcnow().date().isoformat()

    for rule in app.url_map.iter_rules():

        if (
            "GET" in rule.methods
            and len(rule.arguments) == 0
            and not rule.rule.startswith("/admin")
            and not rule.rule.startswith("/api")
            and rule.endpoint != 'static'
        ):

            pages.append({
                "loc": url_for(rule.endpoint, _external=True),
                "lastmod": today
            })

    sitemap_xml = render_template(
        'sitemap.xml',
        pages=pages
    )

    response = make_response(sitemap_xml)

    response.headers["Content-Type"] = "application/xml"

    return response


# ---------------- ROBOTS ----------------

robots = """User-agent: *
Allow: /

Disallow: /admin/
Disallow: /api/

Sitemap: https://www.maduraisamyukthatravels.com/sitemap.xml
"""

    return response

from flask import redirect, request

@app.before_request
def force_www():

    host = request.host

    if host == "maduraisamyukthatravels.com":

        return redirect(
            request.url.replace(
                "https://maduraisamyukthatravels.com",
                "https://www.maduraisamyukthatravels.com"
            ),
            code=301
        )
# ---------------- FRONT PAGES ----------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/about")
def about():
    return render_template("about.html")


@app.route("/tarrif")
def tarrif():
    return render_template("tarrif.html")
    
@app.route("/cars")
def cars():
    return render_template("cars.html")

@app.route("/packages")
def packages():
    return render_template("packages.html")


@app.route("/contact")
def contact():
    return render_template("contact.html")


@app.route("/taxi", methods=["GET", "POST"])
def taxi():
    if request.method == "POST":
        from_city = request.form.get("from")
        to_city = request.form.get("to")
        date = request.form.get("date")
        name = request.form.get("customer_name")
        phone = request.form.get("customer_phone")
        car_type = request.form.get("car_type")

        
        if not all([from_city, to_city, date, name, phone, car_type]):
            flash("All fields are required", "error")
            return redirect(url_for("taxi"))

        conn = db()
        cur = conn.cursor()

        cur.execute("""
            INSERT INTO trips
            (from_city, to_city, date, customer_name, customer_phone, vehicle_type, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?)
        """, (
            from_city,
            to_city,
            date,
            name,
            phone,
            car_type,
            datetime.now().isoformat(timespec="seconds")
        ))

        conn.commit()
        conn.close()

        # --- Notification: OWNER (Immediate Alert on New Booking) ---
        print(f"DEBUG: [BOOKING] Building alert for {name} ({phone})...")
        owner_alert = (
            f"🔔 *New Booking Requested!*\n\n"
            f"👤 Customer: {name}\n"
            f"📱 Phone: {phone}\n"
            f"📍 Route: {from_city} ➡ {to_city}\n"
            f"📅 Date: {date}\n"
            f"🚕 Vehicle: {car_type}\n\n"
            f"Please check the admin panel to confirm."
        )
        print(f"DEBUG: [BOOKING] Handing over to notify_admins()...")
        notify_admins(owner_alert)

        return redirect(url_for(
            "booking",
            from_city=from_city,
            to_city=to_city,
            date=date,
            customer_name=name,
            customer_phone=phone,
            car_type=car_type
        ))

    return render_template("taxi.html")



@app.route("/booking")
def booking():
    return render_template(
        "booking.html",
        from_city=request.args.get("from_city"),
        to_city=request.args.get("to_city"),
        date=request.args.get("date"),
        customer_name=request.args.get("customer_name"),
        phone=request.args.get("customer_phone"),
        car_type=request.args.get("car_type")
    )
    


@app.route("/login")
def login():
    return render_template("login.html")


# ---------------- ADMIN AUTH ----------------

def admin_required():
    return session.get("admin_logged_in") is True

@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        conn = db()
        cur = conn.cursor()
        cur.execute("SELECT * FROM admins WHERE username=?", (username,))
        row = cur.fetchone()
        conn.close()

        if row and check_password_hash(row["password_hash"], password):
            session["admin_logged_in"] = True
            session["admin_username"] = username
            return redirect(url_for("admin_dashboard"))
        else:
            flash("Invalid admin username or password", "error")
            return redirect(url_for("admin_login"))

    return render_template("admin_login.html")

@app.route("/admin/logout")
def admin_logout():
    session.clear()
    return redirect(url_for("admin_login"))


# ---------------- ADMIN DASHBOARD ----------------

@app.route("/admin")
def admin_dashboard():
    if not admin_required():
        return redirect(url_for("admin_login"))

    conn = db()
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) AS c FROM trips WHERE status='Active'")
    active_trips = cur.fetchone()["c"]

    cur.execute("SELECT COUNT(*) AS c FROM drivers WHERE status='Available'")
    available_drivers = cur.fetchone()["c"]

    cur.execute("SELECT COALESCE(SUM(km_run),0) AS km FROM trips WHERE status='Completed'")
    total_km = cur.fetchone()["km"]

    cur.execute("SELECT COALESCE(SUM(revenue),0) AS rev FROM trips WHERE status='Completed'")
    revenue = cur.fetchone()["rev"]

    cur.execute("SELECT COALESCE(SUM(fuel_cost + other_expense),0) AS exp FROM trips WHERE status='Completed'")
    expense = cur.fetchone()["exp"]

    profit = revenue - expense

    cur.execute("""
        SELECT t.*, d.name AS driver_name
        FROM trips t
        LEFT JOIN drivers d ON t.driver_id = d.id
        ORDER BY t.id DESC
        LIMIT 10
    """)
    recent = cur.fetchall()

    conn.close()

    return render_template(
        "admin_dashboard.html",
        active_trips=active_trips,
        available_drivers=available_drivers,
        total_km=total_km,
        revenue=revenue,
        expense=expense,
        profit=profit,
        recent_trips=recent
    )


# ---------------- DRIVERS ----------------

@app.route("/admin/drivers", methods=["GET", "POST"])
def admin_drivers():
    if not admin_required():
        return redirect(url_for("admin_login"))

    conn = db()
    cur = conn.cursor()

    if request.method == "POST":
        name = request.form.get("name")
        phone = request.form.get("phone")
        cur.execute("INSERT INTO drivers (name, phone, status) VALUES (?, ?, 'Available')", (name, phone))
        conn.commit()
        return redirect(url_for("admin_drivers"))

    cur.execute("SELECT * FROM drivers ORDER BY id DESC")
    drivers = cur.fetchall()
    conn.close()

    return render_template("admin_drivers.html", drivers=drivers)

@app.route("/admin/drivers/status", methods=["POST"])
def admin_driver_status():
    if not admin_required():
        return redirect(url_for("admin_login"))

    driver_id = request.form.get("driver_id")
    status = request.form.get("status")

    conn = db()
    cur = conn.cursor()
    cur.execute("UPDATE drivers SET status=? WHERE id=?", (status, driver_id))
    conn.commit()
    conn.close()
    return redirect(url_for("admin_drivers"))


# ---------------- TRIPS ----------------

@app.route("/admin/trips", methods=["GET", "POST"])
def admin_trips():
    if not admin_required():
        return redirect(url_for("admin_login"))

    conn = db()
    cur = conn.cursor()

    if request.method == "POST":
        customer_name = request.form.get("customer_name")
        customer_phone = request.form.get("customer_phone")
        from_city = request.form.get("from_city")
        to_city = request.form.get("to_city")
        date = request.form.get("date")
        vehicle_type = request.form.get("vehicle_type")
        driver_id = request.form.get("driver_id") or None

        cur.execute("""
            INSERT INTO trips (customer_name, customer_phone, from_city, to_city, date, vehicle_type, driver_id, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?)
        """, (customer_name, customer_phone, from_city, to_city, date, vehicle_type, driver_id,
              datetime.now().isoformat(timespec="seconds")))

        if driver_id:
            cur.execute("UPDATE drivers SET status='On Trip' WHERE id=?", (driver_id,))

        conn.commit()
        return redirect(url_for("admin_trips"))

    cur.execute("SELECT * FROM drivers ORDER BY name ASC")
    drivers = cur.fetchall()

    cur.execute("""
        SELECT t.*, d.name AS driver_name
        FROM trips t
        LEFT JOIN drivers d ON t.driver_id = d.id
        ORDER BY t.id DESC
    """)
    trips = cur.fetchall()

    conn.close()
    return render_template("admin_trips.html", trips=trips, drivers=drivers)


@app.route("/admin/trips/confirm", methods=["POST"])
def admin_confirm_trip():
    if not admin_required():
        return redirect(url_for("admin_login"))

    trip_id = request.form.get("trip_id")
    driver_id = request.form.get("driver_id")

    if not trip_id or not driver_id:
        flash("Trip ID or Driver not selected!", "error")
        return redirect(url_for("admin_trips"))

    conn = db()
    cur = conn.cursor()

    # 1. Update trip status to Active and assign driver
    cur.execute("""
        UPDATE trips
        SET status='Active', driver_id=?
        WHERE id=?
    """, (driver_id, trip_id))

    # 2. Update driver status to On Trip
    cur.execute("UPDATE drivers SET status='On Trip' WHERE id=?", (driver_id,))
    conn.commit()

    # 3. Fetch details for automated WhatsApp notification
    cur.execute("""
        SELECT t.*, d.name AS driver_name, d.phone AS driver_phone
        FROM trips t
        LEFT JOIN drivers d ON t.driver_id = d.id
        WHERE t.id=?
    """, (trip_id,))
    trip = cur.fetchone()
    conn.close()

    if trip:
        # --- Notification: OWNER Only ---
        owner_msg = (
            f"✅ *Trip Confirmed & Assigned!*\n\n"
            f"Trip ID: #{trip['id']}\n"
            f"Customer: {trip['customer_name']} ({trip['customer_phone']})\n"
            f"Route: {trip['from_city']} ➡ {trip['to_city']} on {trip['date']}\n"
            f"Driver Assigned: {trip['driver_name']} ({trip['driver_phone']})\n"
        )
        notify_admins(owner_msg)

    flash(f"Trip #{trip_id} confirmed. Notification sent to owner.", "success")
    return redirect(url_for("admin_trips"))

@app.route("/admin/trips/complete", methods=["POST"])
def admin_trip_complete():
    if not admin_required():
        return redirect(url_for("admin_login"))

    trip_id = request.form.get("trip_id")
    km_run = float(request.form.get("km_run") or 0)
    revenue = float(request.form.get("revenue") or 0)
    fuel_cost = float(request.form.get("fuel_cost") or 0)
    other_expense = float(request.form.get("other_expense") or 0)

    conn = db()
    cur = conn.cursor()

    cur.execute("SELECT driver_id FROM trips WHERE id=?", (trip_id,))
    row = cur.fetchone()
    driver_id = row["driver_id"] if row else None

    cur.execute("""
        UPDATE trips
        SET status='Completed', km_run=?, revenue=?, fuel_cost=?, other_expense=?
        WHERE id=?
    """, (km_run, revenue, fuel_cost, other_expense, trip_id))

    if driver_id:
        cur.execute("UPDATE drivers SET status='Available' WHERE id=?", (driver_id,))

    conn.commit()
    conn.close()
    return redirect(url_for("admin_trips"))




from flask import jsonify
@app.route("/api/trip/<int:trip_id>")
def api_trip(trip_id):
    conn = db()
    cur = conn.cursor()

    cur.execute("""
        SELECT t.*, d.name AS driver_name, d.phone AS driver_phone
        FROM trips t
        LEFT JOIN drivers d ON t.driver_id = d.id
        WHERE t.id=?
    """, (trip_id,))

    trip = cur.fetchone()
    conn.close()

    if not trip:
        return jsonify({"error": "Trip not found"}), 404

    return jsonify(dict(trip))

@app.route("/api/trip/<int:trip_id>/status", methods=["POST"])
def api_update_trip_status(trip_id):
    status = request.json.get("status")

    conn = db()
    cur = conn.cursor()
    cur.execute("UPDATE trips SET status=? WHERE id=?", (status, trip_id))
    conn.commit()
    conn.close()

    return jsonify({"success": True})

@app.route("/simulate_driver")
def simulate_driver():
    return render_template("simulate_driver.html", 
        realtime_socket_url=os.environ.get("REALTIME_SOCKET_URL", "http://localhost:4000"))



@app.route("/book-taxi", methods=["POST"])
def book_taxi():
    customer_name = request.form["customer_name"]
    customer_phone = request.form["customer_phone"]
    from_city = request.form["from_city"]
    to_city = request.form["to_city"]
    date = request.form["date"]
    vehicle_type = request.form["vehicle_type"]

    conn = db()
    cur = conn.cursor()

    cur.execute("""
        INSERT INTO trips
        (customer_name, customer_phone, from_city, to_city, date, vehicle_type, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?)
    """, (
        customer_name, customer_phone, from_city, to_city,
        date, vehicle_type, datetime.now().isoformat(timespec="seconds")
    ))

    conn.commit()
    conn.close()

    # --- Notification: OWNER (Immediate Alert on New Booking) ---
    owner_alert = (
        f"🔔 *New Booking Requested!*\n\n"
        f"👤 Customer: {customer_name}\n"
        f"📱 Phone: {customer_phone}\n"
        f"📍 Route: {from_city} ➡ {to_city}\n"
        f"📅 Date: {date}\n"
        f"🚕 Vehicle: {vehicle_type}\n\n"
        f"Please check the admin panel."
    )
    notify_admins(owner_alert)

    return redirect(url_for(
        "booking",
        from_city=from_city,
        to_city=to_city,
        date=date,
        customer_name=customer_name,
        customer_phone=customer_phone,
        car_type=vehicle_type
    ))


from flask import jsonify

@app.route("/test")
def test():
    return jsonify({"message": "Backend connected successfully"})

@app.route("/api/test-notify")
def test_notify():
    """Visit this URL to test Flask to WhatsApp bot connection."""
    test_msg = (
        "🧪 *TEST MESSAGE*\n\n"
        "If you see this, your WhatsApp notification system is working!\n"
        f"Sent at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
    )
    print(f"DEBUG: [TEST] Calling WhatsApp API at {WHATSAPP_API_URL}")
    try:
        payload = {"phone": ADMIN_PHONES[0], "message": test_msg}
        resp = requests.post(WHATSAPP_API_URL, json=payload, timeout=60)
        result = resp.json()
        print(f"DEBUG: [TEST] Response: {resp.status_code} -> {result}")
        return jsonify({
            "status": "sent" if resp.status_code == 200 else "failed",
            "bot_response": result,
            "bot_url": WHATSAPP_API_URL,
            "phone": ADMIN_PHONES[0]
        })
    except Exception as e:
        print(f"DEBUG: [TEST] EXCEPTION: {e}")
        return jsonify({
            "status": "error",
            "error": str(e),
            "bot_url": WHATSAPP_API_URL
        }), 500


if __name__ == "__main__":
    app.run(debug=True)
