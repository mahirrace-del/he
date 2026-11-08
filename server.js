/**
 * BioSense AI — School Health Kiosk Standalone Cloud Relay & Web Server
 * ====================================================================
 * A zero-dependency, high-performance Node.js server that provides:
 * 1. Web application hosting for student checkups & kiosk interface
 * 2. Real-time Telemetry Ingestion endpoint (POST /api/telemetry) from ESP32 stations anywhere
 * 3. Real-time Server-Sent Events (SSE) streaming (GET /api/stream?deviceId=XYZ)
 * 4. Active Stations & Hardware Pairing Registry (GET /api/stations)
 * 5. Bidirectional Facial AI Feedback Relay to ESP32 OLED display (POST /api/face-feedback)
 * 6. Student Health Records persistence & Multi-Week Historical Tracker (JSON database in /data)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const RECORDS_FILE = path.join(DATA_DIR, 'health_records.json');
const STUDENTS_FILE = path.join(DATA_DIR, 'students.json');

// Ensure data directory and files exist (safely caught for serverless environments like Vercel)
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(RECORDS_FILE)) {
    fs.writeFileSync(RECORDS_FILE, JSON.stringify([], null, 2));
  }
  if (!fs.existsSync(STUDENTS_FILE)) {
    const sampleStudents = [
      { studentId: "STU-2026-001", name: "Tanvir Ahmed", grade: "Class 7", age: 13, gender: "Male" },
      { studentId: "STU-2026-002", name: "Nusrat Jahan", grade: "Class 8", age: 14, gender: "Female" },
      { studentId: "STU-2026-003", name: "Aayan Rahman", grade: "Class 6", age: 12, gender: "Male" },
      { studentId: "STU-2026-004", name: "Zoya Chowdhury", grade: "Class 9", age: 15, gender: "Female" }
    ];
    fs.writeFileSync(STUDENTS_FILE, JSON.stringify(sampleStudents, null, 2));
  }
} catch (e) {
  // Read-only filesystem in serverless environments
}

// In-Memory Fallbacks for Serverless (Vercel)
let inMemoryRecords = [];
let inMemoryStudents = [
  { studentId: "STU-2026-001", name: "Tanvir Ahmed", grade: "Class 7", age: 13, gender: "Male" },
  { studentId: "STU-2026-002", name: "Nusrat Jahan", grade: "Class 8", age: 14, gender: "Female" },
  { studentId: "STU-2026-003", name: "Aayan Rahman", grade: "Class 6", age: 12, gender: "Male" },
  { studentId: "STU-2026-004", name: "Zoya Chowdhury", grade: "Class 9", age: 15, gender: "Female" }
];

// In-Memory State
// activeStations: Map<deviceId, { deviceId, hr, spo2, temp, ecg, leadsOff, finger, lastSeen, ip }>
const activeStations = new Map();

// activeFaceFeedback: Map<deviceId, { mood, pct, cond, vit, timestamp }>
const activeFaceFeedback = new Map();

// sseListeners: Map<deviceId, Set<http.ServerResponse>>
const sseListeners = new Map();

// MIME Types map
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

// Helper: Read JSON Body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) { // 5MB limit (for base64 photo)
        req.socket.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        const json = body ? JSON.parse(body) : {};
        resolve(json);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// Helper: Send JSON Response
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

// Helper: Load Records
function loadRecords() {
  try {
    if (fs.existsSync(RECORDS_FILE)) {
      const raw = fs.readFileSync(RECORDS_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch {}
  return inMemoryRecords;
}

// Helper: Save Records
function saveRecords(records) {
  inMemoryRecords = records;
  try {
    fs.writeFileSync(RECORDS_FILE, JSON.stringify(records, null, 2));
  } catch {}
}

// Helper: Load Students
function loadStudents() {
  try {
    if (fs.existsSync(STUDENTS_FILE)) {
      const raw = fs.readFileSync(STUDENTS_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch {}
  return inMemoryStudents;
}

// Helper: Save Students
function saveStudents(students) {
  inMemoryStudents = students;
  try {
    fs.writeFileSync(STUDENTS_FILE, JSON.stringify(students, null, 2));
  } catch {}
}

// Broadcast SSE telemetry to all web clients listening to this deviceId
function broadcastTelemetry(deviceId, packet) {
  const listeners = sseListeners.get(deviceId);
  if (!listeners || listeners.size === 0) return;

  const dataStr = `data: ${JSON.stringify(packet)}\n\n`;
  for (const clientRes of listeners) {
    try {
      clientRes.write(dataStr);
    } catch {
      listeners.delete(clientRes);
    }
  }
}

// HTTP Request Handler (compatible with Node.js and Vercel Serverless Functions)
const handleRequest = async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Handle CORS Pre-flight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // ---------------- API ROUTES ----------------

  // 1. ESP32 Telemetry Ingestion (POST /api/telemetry)
  if (pathname === '/api/telemetry' && method === 'POST') {
    try {
      const data = await parseJsonBody(req);
      const deviceId = (data.deviceId || 'ROBOBEE-HEALTH-01').trim().toUpperCase();

      const telemetry = {
        deviceId,
        hr: Number(data.hr) || 0,
        spo2: Number(data.spo2) || 0,
        temp: Number(data.temp) || 36.6,
        ecg: Number(data.ecg) || 2048,
        leadsOff: Boolean(data.leadsOff),
        finger: data.finger !== undefined ? Boolean(data.finger) : (Number(data.hr) > 0 || Number(data.spo2) > 0),
        lastSeen: Date.now(),
        ip: req.socket.remoteAddress || 'unknown'
      };

      activeStations.set(deviceId, telemetry);

      // Immediately push to any active web client listening to this station
      broadcastTelemetry(deviceId, telemetry);

      // Prepare AI Face Feedback response for the ESP32 (if web app has detected mood)
      const feedback = activeFaceFeedback.get(deviceId) || {
        mood: "READY",
        pct: 0,
        cond: "WAITING",
        vit: 100
      };

      sendJson(res, 200, {
        status: "ok",
        receivedAt: Date.now(),
        face: feedback
      });
    } catch (err) {
      sendJson(res, 400, { error: 'Invalid JSON payload: ' + err.message });
    }
    return;
  }

  // 2. Real-Time Server-Sent Events (SSE) Stream (GET /api/stream?deviceId=XYZ)
  if (pathname === '/api/stream' && method === 'GET') {
    const deviceId = (parsedUrl.query.deviceId || 'ROBOBEE-HEALTH-01').toString().trim().toUpperCase();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    res.write(`: connected to stream for device ${deviceId}\n\n`);

    if (!sseListeners.has(deviceId)) {
      sseListeners.set(deviceId, new Set());
    }
    const listeners = sseListeners.get(deviceId);
    listeners.add(res);

    // Send latest known telemetry immediately if available
    const latest = activeStations.get(deviceId);
    if (latest) {
      res.write(`data: ${JSON.stringify(latest)}\n\n`);
    }

    // Keep-alive heartbeat every 15 seconds
    const heartbeat = setInterval(() => {
      try {
        res.write(`: heartbeat\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 15000);

    // Cleanup on disconnect
    req.on('close', () => {
      clearInterval(heartbeat);
      listeners.delete(res);
      if (listeners.size === 0) {
        sseListeners.delete(deviceId);
      }
    });
    return;
  }

  // 3. List Active ESP Stations (GET /api/stations)
  if (pathname === '/api/stations' && method === 'GET') {
    const now = Date.now();
    const stations = [];

    // Ensure default station is listed even before first packet
    if (!activeStations.has('ROBOBEE-HEALTH-01')) {
      activeStations.set('ROBOBEE-HEALTH-01', {
        deviceId: 'ROBOBEE-HEALTH-01',
        hr: 0,
        spo2: 0,
        temp: 36.6,
        ecg: 2048,
        leadsOff: false,
        finger: false,
        lastSeen: 0,
        ip: 'Standby'
      });
    }

    for (const [id, s] of activeStations.entries()) {
      const isOnline = (now - s.lastSeen) < 10000; // online if packet in last 10s
      stations.push({
        deviceId: id,
        isOnline,
        lastSeenAgoSec: s.lastSeen ? Math.round((now - s.lastSeen) / 1000) : null,
        hr: s.hr,
        spo2: s.spo2,
        temp: s.temp,
        leadsOff: s.leadsOff,
        finger: s.finger,
        ip: s.ip
      });
    }

    sendJson(res, 200, { stations, timestamp: now });
    return;
  }

  // 4. Send Facial AI Feedback to ESP (POST /api/face-feedback)
  if (pathname === '/api/face-feedback' && method === 'POST') {
    try {
      const data = await parseJsonBody(req);
      const deviceId = (data.deviceId || 'ROBOBEE-HEALTH-01').trim().toUpperCase();

      const feedback = {
        mood: (data.mood || 'NEUTRAL').toUpperCase().substring(0, 10),
        pct: Math.min(100, Math.max(0, Number(data.pct) || 0)),
        cond: (data.condition || 'HEALTHY').toUpperCase().substring(0, 12),
        vit: Math.min(100, Math.max(0, Number(data.vitality) || 100)),
        timestamp: Date.now()
      };

      activeFaceFeedback.set(deviceId, feedback);
      sendJson(res, 200, { status: "ok", deviceId, feedback });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // 5. Save Completed Student Checkup Record (POST /api/records)
  if (pathname === '/api/records' && method === 'POST') {
    try {
      const record = await parseJsonBody(req);
      if (!record.studentId || !record.studentName) {
        sendJson(res, 400, { error: "studentId and studentName are required" });
        return;
      }

      const records = loadRecords();
      record.id = record.id || 'CHK-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
      record.savedAt = new Date().toISOString();
      records.unshift(record); // newest first
      saveRecords(records);

      // Also upsert student in students list
      const students = loadStudents();
      const existingIdx = students.findIndex(s => s.studentId === record.studentId);
      const studentEntry = {
        studentId: record.studentId,
        name: record.studentName,
        grade: record.grade || "Class 8",
        age: record.age || 14,
        gender: record.gender || "Other",
        lastCheckup: record.savedAt,
        lastHealthStatus: record.healthStatus || "Normal"
      };

      if (existingIdx >= 0) {
        students[existingIdx] = { ...students[existingIdx], ...studentEntry };
      } else {
        students.push(studentEntry);
      }
      saveStudents(students);

      sendJson(res, 201, { status: "ok", id: record.id, record });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // 6. Get Historical Records (GET /api/records?studentId=XYZ)
  if (pathname === '/api/records' && method === 'GET') {
    const studentId = parsedUrl.query.studentId;
    const records = loadRecords();

    if (studentId) {
      const filtered = records.filter(r => r.studentId.toLowerCase() === studentId.toLowerCase());
      sendJson(res, 200, { studentId, count: filtered.length, records: filtered });
    } else {
      sendJson(res, 200, { count: records.length, records });
    }
    return;
  }

  // 7. Get Registered Students (GET /api/students)
  if (pathname === '/api/students' && method === 'GET') {
    const students = loadStudents();
    sendJson(res, 200, { count: students.length, students });
    return;
  }

  // ---------------- STATIC FILE SERVER ----------------
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '\\') {
    safePath = '/index.html';
  }

  const filePath = path.join(PUBLIC_DIR, safePath);

  // Security: check path is inside PUBLIC_DIR
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // 404 handler
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end(`<h1>404 Not Found</h1><p>The path ${pathname} does not exist.</p><p><a href="/">Return to Health Kiosk</a></p>`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
  });
};

// Export handler for Vercel Serverless
module.exports = handleRequest;

// Start Server locally when run directly
if (require.main === module) {
  const server = http.createServer(handleRequest);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`  BioSense AI — School Health Kiosk Cloud Platform   `);
    console.log(`=======================================================`);
    console.log(`Server running at:`);
    console.log(`- Local Web App:        http://localhost:${PORT}`);
    console.log(`- Network Access:       http://<YOUR_IP>:${PORT}`);
    console.log(`- ESP Telemetry API:    http://<YOUR_IP>:${PORT}/api/telemetry`);
    console.log(`- Real-time SSE Stream: http://<YOUR_IP>:${PORT}/api/stream?deviceId=ROBOBEE-HEALTH-01`);
    console.log(`=======================================================`);
  });
}
