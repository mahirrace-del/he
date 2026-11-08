/*
 * BioSense AI — ESP32 Wireless Wi-Fi & WebSocket Firmware (Station Mode)
 *
 * Connected Hardware:
 * 1. Mini OLED Display (SSD1306 128x64 I2C) -> SDA: GPIO 21, SCL: GPIO 22 (0x3C)
 * 2. MAX30102 Pulse Oximeter & Heart Rate   -> SDA: GPIO 21, SCL: GPIO 22 (0x57)
 * 3. AD8232 Single-Lead ECG Sensor          -> OUTPUT: GPIO 34, LO+: GPIO 32, LO-: GPIO 33
 * 4. TMP36 Analog Temperature Sensor        -> VOUT: GPIO 35
 *
 * Required Libraries (Install via Arduino Library Manager):
 * - WebSockets by Markus Sattler (WebSocketsServer.h)
 * - Adafruit SSD1306 & Adafruit GFX Library
 * - SparkFun MAX3010x Pulse and Proximity Sensor Library (MAX30105.h)
 */

#include <WiFi.h>
#include <WebSocketsServer.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "MAX30105.h"
#include "heartRate.h"

// ---------------- USER CONFIGURATION ----------------
const char* ssid        = "YOUR_WIFI_SSID";
const char* password    = "YOUR_WIFI_PASSWORD";
const char* DEVICE_ID   = "ROBOBEE-HEALTH-01"; // Unique Station ID

// WebSocket Server on Port 81
WebSocketsServer webSocket = WebSocketsServer(81);

// ---------------- PIN DEFINITIONS ----------------
#define I2C_SDA         21
#define I2C_SCL         22
#define AD8232_OUT_PIN  34
#define AD8232_LOP_PIN  32
#define AD8232_LON_PIN  33
#define TMP36_PIN       35

#define SCREEN_WIDTH    128
#define SCREEN_HEIGHT   64
#define OLED_RESET      -1
#define OLED_ADDR       0x3C

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
MAX30105 particleSensor;

bool max30102Ready = false;
bool oledReady = false;

// Sensor states
const byte RATE_SIZE = 4;
byte rates[RATE_SIZE];
byte rateSpot = 0;
long lastBeat = 0;
float beatsPerMinute = 0;
int beatAvg = 75;
int spo2Value = 98;
float temperatureC = 36.6;
int ecgRaw = 2048;
bool ecgLeadsOff = false;

// Facial AI data received from Website
String aiMood = "WAITING";
String aiCondition = "SCANNING";
int aiMoodPct = 0;
int aiVitality = 100;

unsigned long lastTelemetryMs = 0;
unsigned long lastOledUpdateMs = 0;
uint8_t oledEcgBuffer[128];
uint8_t oledEcgIdx = 0;

float readTmp36Celsius() {
  long sum = 0;
  for (int i = 0; i < 8; i++) sum += analogRead(TMP36_PIN);
  float voltage = ((sum / 8.0) / 4095.0) * 3.3;
  return (voltage - 0.5) * 100.0;
}

// WebSocket Event Handler (Receives face detection thresholds wirelessly from website)
void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.printf("[%u] Website Disconnected!\n", num);
      break;
    case WStype_CONNECTED:
      {
        IPAddress ip = webSocket.remoteIP(num);
        Serial.printf("[%u] Website Client Connected from %d.%d.%d.%d\n", num, ip[0], ip[1], ip[2], ip[3]);
      }
      break;
    case WStype_TEXT:
      {
        String line = String((char*)payload);
        line.trim();
        int c1 = line.indexOf(',');
        int c2 = line.indexOf(',', c1 + 1);
        int c3 = line.indexOf(',', c2 + 1);
        if (c1 > 0 && c2 > c1 && c3 > c2) {
          aiMood = line.substring(0, c1);
          aiMoodPct = line.substring(c1 + 1, c2).toInt();
          aiCondition = line.substring(c2 + 1, c3);
          aiVitality = line.substring(c3 + 1).toInt();
        }
      }
      break;
    default:
      break;
  }
}

void updateMiniOled() {
  if (!oledReady) return;
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);

  // Row 1: Wi-Fi IP & Station ID
  display.setCursor(0, 0);
  display.print(F("ID:"));
  display.print(DEVICE_ID);
  display.print(F(" "));
  display.print(WiFi.localIP());

  // Row 2: AI Face Mood & Percentage from Website Camera
  display.setCursor(0, 10);
  display.print(F("FACE: "));
  display.print(aiMood);
  display.print(F(" "));
  display.print(aiMoodPct);
  display.print(F("%"));

  // Row 3: MAX30102 Heart Rate & SpO2
  display.setCursor(0, 22);
  display.print(F("HR:"));
  display.print(beatAvg);
  display.print(F("bpm SpO2:"));
  display.print(spo2Value);
  display.print(F("%"));

  // Row 4: TMP36 Temp & ECG Status
  display.setCursor(0, 32);
  display.print(F("TMP:"));
  display.print(temperatureC, 1);
  display.print(F("C ECG:"));
  display.print(ecgLeadsOff ? F("OFF") : F("OK"));

  // Bottom Region: AD8232 ECG Waveform
  display.drawLine(0, 42, 127, 42, SSD1306_WHITE);
  for (int x = 0; x < 127; x++) {
    display.drawLine(x, oledEcgBuffer[(oledEcgIdx + x) % 128], x + 1, oledEcgBuffer[(oledEcgIdx + x + 1) % 128], SSD1306_WHITE);
  }
  display.display();
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  pinMode(AD8232_OUT_PIN, INPUT);
  pinMode(AD8232_LOP_PIN, INPUT);
  pinMode(AD8232_LON_PIN, INPUT);
  pinMode(TMP36_PIN, INPUT);

  for (int i = 0; i < 128; i++) oledEcgBuffer[i] = 54;
  Wire.begin(I2C_SDA, I2C_SCL);

  // Initialize OLED
  if (display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    oledReady = true;
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println(F("Connecting Wi-Fi..."));
    display.display();
  }

  // Connect to Wi-Fi
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println("\nWi-Fi Connected!");
  Serial.print("ESP32 IP Address: ");
  Serial.println(WiFi.localIP());

  if (oledReady) {
    display.clearDisplay();
    display.setCursor(0, 0);
    display.println(F("Wi-Fi Connected!"));
    display.print(F("IP: "));
    display.println(WiFi.localIP());
    display.display();
    delay(1500);
  }

  // Start WebSocket Server on port 81
  webSocket.begin();
  webSocket.onEvent(webSocketEvent);

  // Initialize MAX30102
  if (particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    particleSensor.setup();
    particleSensor.setPulseAmplitudeRed(0x1F);
    particleSensor.setPulseAmplitudeGreen(0);
    max30102Ready = true;
  }
}

void loop() {
  webSocket.loop();

  // MAX30102 processing
  if (max30102Ready) {
    long irValue = particleSensor.getIR();
    long redValue = particleSensor.getRed();
    if (irValue > 50000) {
      if (checkForBeat(irValue)) {
        long delta = millis() - lastBeat;
        lastBeat = millis();
        beatsPerMinute = 60 / (delta / 1000.0);
        if (beatsPerMinute < 220 && beatsPerMinute > 40) {
          rates[rateSpot++] = (byte)beatsPerMinute;
          rateSpot %= RATE_SIZE;
          beatAvg = 0;
          for (byte x = 0; x < RATE_SIZE; x++) beatAvg += rates[x];
          beatAvg /= RATE_SIZE;
        }
      }
      spo2Value = constrain((int)(110.0 - 18.0 * ((float)redValue / (float)irValue)), 85, 100);
    }
  }

  // AD8232 & TMP36 Telemetry streaming over Wi-Fi WebSocket (25 Hz)
  unsigned long now = millis();
  if (now - lastTelemetryMs >= 40) {
    lastTelemetryMs = now;
    ecgLeadsOff = (digitalRead(AD8232_LOP_PIN) == 1) || (digitalRead(AD8232_LON_PIN) == 1);
    ecgRaw = ecgLeadsOff ? 2048 : analogRead(AD8232_OUT_PIN);
    oledEcgBuffer[oledEcgIdx] = map(constrain(ecgRaw, 800, 3300), 800, 3300, 62, 44);
    oledEcgIdx = (oledEcgIdx + 1) % 128;
    temperatureC = readTmp36Celsius();

    // Broadcast JSON telemetry wirelessly to all connected web clients with deviceId
    String json = "{\"deviceId\":\"" + String(DEVICE_ID) +
                  "\",\"hr\":" + String(beatAvg) +
                  ",\"spo2\":" + String(spo2Value) +
                  ",\"temp\":" + String(temperatureC, 1) +
                  ",\"ecg\":" + String(ecgRaw) +
                  ",\"leadsOff\":" + (ecgLeadsOff ? "true" : "false") + "}";
    webSocket.broadcastTXT(json);
  }

  if (now - lastOledUpdateMs >= 150) {
    lastOledUpdateMs = now;
    updateMiniOled();
  }
}
