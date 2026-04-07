from flask import Flask, render_template, request, redirect, url_for, session, flash, make_response
from flask_cors import CORS
import os
import sqlite3
import requests
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash

# ================= WHATSAPP API CONFIGURATION (OPEN SOURCE) =================
# This system now uses your local computer via ngrok tunnel.
# You MUST run 'node realtime/server.js' AND 'ngrok http 10000' on your PC!
ADMIN_PHONES = ['918300302815'] 
WHATSAPP_API_URL = os.environ.get("WHATSAPP_API_URL", "https://enterpriseless-noma-nonadjunctively.ngrok-free.app/api/send-whatsapp")
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
    """Sends WhatsApp alert via local bot or Callmebot fallback."""
    import urllib.parse

    # 1. Try Local WhatsApp Bot API (realtime/server.js)
    try:
        payload = {"phone": phone, "message": message_body}
        resp = requests.post(WHATSAPP_API_URL, json=payload, timeout=5)
        if resp.status_code == 200:
            print(f"WhatsApp Local Bot: Sent successfully to {phone}")
            return {"status": "success", "provider": "local"}
    except Exception as e:
        print(f"WhatsApp Local Bot failed for {phone}: {e}. Falling back to Callmebot...")

    # 2. Fallback to Callmebot
    clean_phone = str(phone).replace('+', '').replace(' ', '').strip()
    if not clean_phone.startswith('91') and len(clean_phone) == 10:
        clean_phone = '91' + clean_phone

    api_key = os.environ.get("CALLMEBOT_API_KEY", "")
    if not api_key:
        print(f"WARNING: CALLMEBOT_API_KEY not set and Local Bot failed for {phone}. WhatsApp NOT sent.")
        return None

    encoded_msg = urllib.parse.quote(message_body)
    url = f"https://api.callmebot.com/whatsapp.php?phone={clean_phone}&text={encoded_msg}&apikey={api_key}"

    try:
        response = requests.get(url, timeout=20)
        print(f"WhatsApp Callmebot: Status={response.status_code}, Response={response.text[:100]}")
        return {"status": response.status_code, "provider": "callmebot"}
    except Exception as e:
        print(f"CRITICAL: All WhatsApp providers failed for {phone}: {e}")
        return None

def notify_admins(message_body):
    """Sends a notification to all admin phone numbers."""
    results = []
    for phone in ADMIN_PHONES:
        res = send_whatsapp_message(phone, message_body)
        results.append(res)
    return results


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

# ================ PERFORMANCE: CACHING HEADERS ================
@app.after_request
def add_cache_headers(response):
    """Add caching headers for static files to improve performance"""
    if request.path.startswith('/static/'):
        # Cache static files for 1 year
        response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    elif request.path in ['/sitemap.xml', '/robots.txt']:
        # Cache SEO files for 1 day
        response.headers['Cache-Control'] = 'public, max-age=86400'
    else:
        # Don't cache dynamic pages
        response.headers['Cache-Control'] = 'no-cache, must-revalidate'
    return response

# ---------------- SEO & UTILS ----------------

@app.route('/sitemap.xml', methods=['GET'])
def sitemap():
    pages = []
    ten_days_ago = datetime.now().date().isoformat()
    # Add static pages
    for rule in app.url_map.iter_rules():
        if "GET" in rule.methods and len(rule.arguments) == 0:
            if not rule.rule.startswith("/admin") and not rule.rule.startswith("/api") and rule.endpoint != 'static':
                pages.append([url_for(rule.endpoint, _external=True), ten_days_ago])

    sitemap_xml = render_template('sitemap.xml', pages=pages)
    response = make_response(sitemap_xml)
    response.headers["Content-Type"] = "application/xml"
    return response

@app.route('/robots.txt')
def robots():
    lines = [
        "User-agent: *",
        "Disallow: /admin/",
        "Disallow: /api/",
        f"Sitemap: {request.url_root}sitemap.xml"
    ]
    response = make_response("\n".join(lines))
    response.headers["Content-Type"] = "text/plain"
    return response

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
        owner_alert = (
            f"🔔 *New Booking Requested!*\n\n"
            f"👤 Customer: {name}\n"
            f"📱 Phone: {phone}\n"
            f"📍 Route: {from_city} ➡ {to_city}\n"
            f"📅 Date: {date}\n"
            f"🚕 Vehicle: {car_type}\n\n"
            f"Please check the admin panel to confirm."
        )
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





if __name__ == "__main__":
    app.run(debug=True)