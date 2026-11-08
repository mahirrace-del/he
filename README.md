# BioSense AI — School Health & Mental Well-Being Kiosk System

An automated, clinical-grade IoT health screening kiosk engineered for **regular weekly student checkups** in schools, colleges, and training institutes.

> [!NOTE]
> **Completely Standalone Project**: This platform is 100% self-contained in `school_health_kiosk/`. It has zero dependencies on any external website and runs with pure Node.js and standard browser web APIs.

---

## 1. System Architecture & Multi-ESP Cloud Pairing

```
       [ ESP32 Health Station A ]                  [ ESP32 Health Station B ]
      (Device ID: ROBOBEE-HEALTH-01)              (Device ID: HEALTH-KIOSK-B)
       [MAX30102 + AD8232 + TMP36]                [MAX30102 + AD8232 + TMP36]
                   │                                           │
                   ▼ (Wi-Fi / Internet)                        ▼ (Wi-Fi / Internet)
      ┌──────────────────────────────────────────────────────────────┐
      │       BioSense Cloud IoT Server / Web Relay (Node.js)        │
      │                  (http://<your-domain>:3000)                 │
      │   - Ingests Telemetry: POST /api/telemetry                   │
      │   - Real-Time Broadcast: GET /api/stream?deviceId=...        │
      │   - Bidirectional Face Feedback: POST /api/face-feedback     │
      └──────────────────────────────────────────────────────────────┘
                                      │
                   ┌──────────────────┴──────────────────┐
                   ▼                                     ▼
      [ School Nurse Laptop A ]              [ School Nurse Laptop B ]
   (Browser: http://<domain>:3000)        (Browser: http://<domain>:3000)
    Selects Station: ROBOBEE-HEALTH-01     Selects Station: HEALTH-KIOSK-B
```

### How the Cloud & Unique Device ID Connection Works:
1. **The ESP32 connects to Wi-Fi / Internet** (or a phone hotspot).
2. Each ESP32 is assigned its own unique **`DEVICE_ID`** in the code (e.g. `ROBOBEE-HEALTH-01`, `STATION-ALPHA`).
3. The ESP32 streams its sensor telemetry packets directly to your server URL via HTTP POST:
   ```json
   {
     "deviceId": "ROBOBEE-HEALTH-01",
     "hr": 78,
     "spo2": 98,
     "temp": 36.7,
     "ecg": 2150,
     "leadsOff": false,
     "finger": true
   }
   ```
4. **On the Web Application**:
   - Anyone with the website link opens the page in their browser.
   - In the top header bar, they simply **select or enter the ESP Station ID** they want to operate.
   - The web page opens an active real-time stream (`/api/stream?deviceId=ROBOBEE-HEALTH-01`) and receives the live telemetry from **THAT specific ESP32**!
   - Multiple schools or classrooms can operate multiple ESP stations simultaneously without cross-talk.

---

## 2. The 6-Step Clinical Checkup Workflow

| Step | Phase | What Happens on Screen |
| :--- | :--- | :--- |
| **Step 1** | **Student Intake & Questionnaire** | Enter Student Name, Student ID (Roll No), Class/Grade, Age, Gender, and 4 quick health questions (Sleep hours last night, feeling sick/fatigued, breakfast & hydration, chest pain/dizziness). |
| **Step 2** | **Sensor Placement Guidance** | Interactive cards show the student exactly how to attach the MAX30102 pulse oximeter, AD8232 ECG electrodes (RA, LA, RL), TMP36 temperature probe, and align their face with the webcam. Live checkmarks confirm hardware readiness. |
| **Step 3** | **20s Vitals & ECG Oscilloscope** | Real-time medical ECG oscilloscope canvas (25 mm/s sweep, 10 mm/mV scale) with PQRST wave visualization. Digital gauges for Heart Rate, SpO2 (%), and Temperature (°C/°F). Runs a 20-second clinical averaging countdown. |
| **Step 4** | **Webcam Facial Expression AI** | Uses the laptop camera directly in the browser to detect emotional valence (Happy, Calm, Fatigued, Stressed, Low Mood), Facial Vitality (0–100%), and Mental Stress Index. Captures a snapshot photo for the medical card and sends live mood feedback back to the ESP32 OLED display! |
| **Step 5** | **Standards Comparison & Review** | Automatically evaluates measured vitals against WHO and American Academy of Pediatrics (AAP) standards. Computes an Overall Composite Health Score (0–100) and displays personalized clinical recommendations. |
| **Step 6** | **Official Health Card & Export** | Generates an official, printable Student Health Card with the student's photo, vitals table, ECG waveform strip, and signatures. Provides **1-Click Print** and **Multi-Week Historical Tracking**! |

---

## 3. Directory Layout

```
school_health_kiosk/
├── firmware/
│   ├── esp32_cloud_iot_firmware.ino       # Main Wi-Fi Cloud Telemetry Firmware with unique Device ID
│   ├── esp32_wireless_firmware.ino        # Direct local Wi-Fi WebSocket Firmware (Port 81)
│   ├── esp32_health_firmware.ino          # Direct USB WebSerial Firmware (115200 baud)
│   └── circuit_and_wiring_guide.md        # Complete pinout, circuit schematics, and electrode placement
├── public/
│   ├── index.html                         # Full single-page clinical kiosk application
│   ├── css/
│   │   └── style.css                      # Modern hospital monitor theme & print stylesheet
│   └── js/
│       ├── app.js                         # Master 6-step workflow coordinator
│       ├── esp_connector.js               # Cloud SSE, Wi-Fi WS, WebSerial, and Simulator connector
│       ├── ecg_oscilloscope.js            # Real-time medical ECG canvas oscilloscope (25 mm/s)
│       ├── face_stress_ai.js              # Webcam facial expression & mental stress detection engine
│       ├── medical_standards.js           # WHO/Pediatric standards comparator & health score engine
│       └── report_generator.js            # Printable report card generator & multi-week history
├── data/
│   ├── health_records.json                # Saved checkups database
│   └── students.json                      # Registered students list
├── server.js                              # Zero-dependency Node.js cloud relay & web server
├── package.json                           # Scripts (`npm start`)
└── README.md                              # This documentation
```

---

## 4. Hardware Wiring Summary

| Module | Module Pin | ESP32 GPIO Pin | Function |
| :--- | :--- | :--- | :--- |
| **SSD1306 OLED (128x64)** | SDA / SCL | **GPIO 21 / GPIO 22** | Hardware I2C (Address: `0x3C`) |
| **MAX30102 Oximeter** | SDA / SCL | **GPIO 21 / GPIO 22** | Hardware I2C (Address: `0x57`) |
| **AD8232 ECG Sensor** | OUTPUT | **GPIO 34** | Analog Input (ADC1_CH6) |
| | LO+ / LO- | **GPIO 32 / GPIO 33** | Leads-Off Digital Inputs |
| **TMP36 Temp Sensor** | VOUT | **GPIO 35** | Analog Input (ADC1_CH7) |
| **Power** | 3.3V & GND | **3.3V & GND** | Regulated ESP32 3.3V Rail |

> [!IMPORTANT]
> All analog inputs (**GPIO 34 and GPIO 35**) are on **ADC1**, ensuring full compatibility while the ESP32 Wi-Fi radio is active.

---

## 5. How to Run & Test the System

### Step A: Start the Web Server
Open a terminal in `school_health_kiosk/` and run:
```bash
node server.js
```
The server will start on port `3000`:
- Local access: `http://localhost:3000`
- Network access: `http://<YOUR_LAPTOP_IP>:3000`

### Step B: Test Instantly with Demo Mode (Zero Hardware Required)
1. Open `http://localhost:3000` in Google Chrome or Microsoft Edge.
2. In the top bar, click the **"🧪 Demo"** button.
3. The simulator immediately generates authentic human biosignals (76 BPM, 98% SpO2, 36.6°C temp, and sweeping P-Q-R-S-T ECG waveforms).
4. Run through the full 6 steps: enter a student name, test the camera facial scan, view the standard comparison, and print the official medical report card!

### Step C: Connect the Physical ESP32 Hardware
1. Open `firmware/esp32_cloud_iot_firmware.ino` in Arduino IDE.
2. Update your Wi-Fi credentials:
   ```cpp
   const char* WIFI_SSID     = "YOUR_WIFI_NAME";
   const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
   const char* DEVICE_ID     = "ROBOBEE-HEALTH-01";
   const char* SERVER_URL    = "http://<YOUR_SERVER_IP>:3000/api/telemetry";
   ```
3. Upload to the ESP32.
4. When powered on, the ESP32 connects to your Wi-Fi, displays its IP on the OLED, and begins transmitting live sensor telemetry.
5. In the web app, select **`ROBOBEE-HEALTH-01`** in **🌐 Cloud** mode. The live data and ECG trace will immediately stream to your screen!

### Step D: Alternative Connection Modes
- **🔌 USB Cable Mode**: If Wi-Fi is unavailable, plug the ESP32 into your laptop via USB, select **"🔌 USB"** in the top bar, and grant serial access at 115200 baud.
- **📶 Direct Local Wi-Fi WebSocket**: If running directly on a local LAN router without a cloud server, select **"📶 Wi-Fi"** and enter the ESP32 IP shown on its OLED screen.
