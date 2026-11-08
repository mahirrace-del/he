/*
 * BioSense AI — ESP32 Smart Health & Facial Diagnostic Firmware (USB WebSerial Mode)
 *
 * Connected Hardware:
 * 1. Mini OLED Display (SSD1306 128x64 I2C) -> SDA: GPIO 21, SCL: GPIO 22 (Addr: 0x3C)
 * 2. MAX30102 Pulse Oximeter & Heart Rate   -> SDA: GPIO 21, SCL: GPIO 22 (Addr: 0x57)
 * 3. AD8232 Single-Lead ECG Sensor          -> OUTPUT: GPIO 34 (ADC1_CH6), LO+: GPIO 32, LO-: GPIO 33
 * 4. TMP36 Analog Temperature Sensor        -> VOUT: GPIO 35 (ADC1_CH7)
 *
 * Required Arduino Libraries:
 * - Adafruit SSD1306 & Adafruit GFX Library
 * - SparkFun MAX3010x Pulse and Proximity Sensor Library (MAX30105.h)
 */

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "MAX30105.h"
#include "heartRate.h"

// ---------------- PIN DEFINITIONS ----------------
#define I2C_SDA         21
#define I2C_SCL         22

// AD8232 ECG Pins (Use ADC1 pins on ESP32)
#define AD8232_OUT_PIN  34
#define AD8232_LOP_PIN  32
#define AD8232_LON_PIN  33

// TMP36 Temperature Sensor Pin (ADC1)
#define TMP36_PIN       35

// Mini OLED Configuration
#define SCREEN_WIDTH    128
#define SCREEN_HEIGHT   64
#define OLED_RESET      -1
#define OLED_ADDR       0x3C

const char* DEVICE_ID = "ROBOBEE-HEALTH-01";

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
MAX30105 particleSensor;

// ---------------- STATE VARIABLES ----------------
bool max30102Ready = false;
bool oledReady = false;

// MAX30102 Heart Rate & SpO2 state
const byte RATE_SIZE = 4;
byte rates[RATE_SIZE];
byte rateSpot = 0;
long lastBeat = 0;
float beatsPerMinute = 0;
int beatAvg = 75;
int spo2Value = 98;

// TMP36 Temperature state
float temperatureC = 36.6;

// AD8232 ECG state
int ecgRaw = 2048;
bool ecgLeadsOff = false;

// Facial AI state received from Website over USB Serial
String aiMood = "WAITING";
String aiCondition = "SCANNING";
int aiMoodPct = 0;
int aiVitality = 100;

// Timing
unsigned long lastTelemetryMs = 0;
unsigned long lastOledUpdateMs = 0;

// Mini ECG buffer for OLED bottom waveform (128 pixels wide)
uint8_t oledEcgBuffer[128];
uint8_t oledEcgIdx = 0;

void setup() {
  Serial.begin(115200);
  delay(200);

  // Configure ADC & Sensor Pins
  analogReadResolution(12); // 0 - 4095 for 0 - 3.3V
  pinMode(AD8232_OUT_PIN, INPUT);
  pinMode(AD8232_LOP_PIN, INPUT);
  pinMode(AD8232_LON_PIN, INPUT);
  pinMode(TMP36_PIN, INPUT);

  for (int i = 0; i < 128; i++) {
    oledEcgBuffer[i] = 54;
  }

  // Initialize I2C Bus
  Wire.begin(I2C_SDA, I2C_SCL);

  // 1. Initialize Mini OLED Display (SSD1306)
  if (display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    oledReady = true;
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println(F("BioSense AI - ESP32"));
    display.println(F("Initializing..."));
    display.display();
  }

  // 2. Initialize MAX30102 Oximeter Sensor
  if (particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    particleSensor.setup(); // Configure sensor with default settings
    particleSensor.setPulseAmplitudeRed(0x1F);
    particleSensor.setPulseAmplitudeGreen(0);
    max30102Ready = true;
  }
}

// Read TMP36 Temperature in Celsius
float readTmp36Celsius() {
  // Average 8 samples for low noise on ESP32 ADC
  long sum = 0;
  for (int i = 0; i < 8; i++) {
    sum += analogRead(TMP36_PIN);
  }
  float adcAvg = sum / 8.0;
  float voltage = (adcAvg / 4095.0) * 3.3; // 3.3V reference
  // TMP36 formula: Temp (°C) = (Vout - 0.5V) * 100
  float tempC = (voltage - 0.5) * 100.0;
  return tempC;
}

// Read incoming facial AI data from Website (Format: MOOD,MOOD_PCT,CONDITION,VITALITY\n)
void readWebsiteSerialCommand() {
  while (Serial.available() > 0) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;

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
}

// Update the 128x64 Mini OLED Display
void updateMiniOled() {
  if (!oledReady) return;

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);

  // Row 1: AI Face Mood & Percentage from Website Camera
  display.setCursor(0, 0);
  display.print(F("FACE: "));
  display.print(aiMood);
  display.print(F(" "));
  display.print(aiMoodPct);
  display.print(F("%"));

  // Row 2: AI Facial Disease / Health Condition
  display.setCursor(0, 10);
  display.print(F("COND: "));
  display.print(aiCondition.substring(0, 14));

  // Row 3: MAX30102 Heart Rate & SpO2
  display.setCursor(0, 22);
  display.print(F("HR:"));
  display.print(beatAvg);
  display.print(F("bpm SpO2:"));
  display.print(spo2Value);
  display.print(F("%"));

  // Row 4: TMP36 Temperature & AD8232 Lead Status
  display.setCursor(0, 32);
  display.print(F("TMP:"));
  display.print(temperatureC, 1);
  display.print(F("C ECG:"));
  display.print(ecgLeadsOff ? F("OFF") : F("OK"));

  // Bottom Region (y = 43..63): Live AD8232 ECG Waveform Trace
  display.drawLine(0, 42, 127, 42, SSD1306_WHITE);
  for (int x = 0; x < 127; x++) {
    int i1 = (oledEcgIdx + x) % 128;
    int i2 = (oledEcgIdx + x + 1) % 128;
    display.drawLine(x, oledEcgBuffer[i1], x + 1, oledEcgBuffer[i2], SSD1306_WHITE);
  }

  display.display();
}

void loop() {
  // 1. Check for commands from the Website Camera AI
  readWebsiteSerialCommand();

  // 2. Read MAX30102 Oximeter (IR & Red channels)
  if (max30102Ready) {
    long irValue = particleSensor.getIR();
    long redValue = particleSensor.getRed();

    if (irValue > 50000) {
      if (checkForBeat(irValue) == true) {
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
      // Estimate SpO2 ratio from Red/IR
      float ratio = (float)redValue / (float)irValue;
      int estSpo2 = (int)(110.0 - 18.0 * ratio);
      spo2Value = constrain(estSpo2, 85, 100);
    } else {
      // Finger not placed on MAX30102
      beatAvg = 0;
      spo2Value = 0;
    }
  }

  // 3. Read AD8232 ECG Sensor (25Hz streaming to website + OLED buffer)
  unsigned long now = millis();
  if (now - lastTelemetryMs >= 40) { // 25 Hz update rate
    lastTelemetryMs = now;

    ecgLeadsOff = (digitalRead(AD8232_LOP_PIN) == 1) || (digitalRead(AD8232_LON_PIN) == 1);
    ecgRaw = ecgLeadsOff ? 2048 : analogRead(AD8232_OUT_PIN);

    // Map ECG (0..4095) into OLED bottom wave area (y = 44..62)
    uint8_t mappedY = map(constrain(ecgRaw, 800, 3300), 800, 3300, 62, 44);
    oledEcgBuffer[oledEcgIdx] = mappedY;
    oledEcgIdx = (oledEcgIdx + 1) % 128;

    // 4. Read TMP36 Temperature Sensor
    temperatureC = readTmp36Celsius();

    // 5. Send JSON Telemetry Packet to Website over USB Serial
    Serial.print(F("{\"deviceId\":\""));
    Serial.print(DEVICE_ID);
    Serial.print(F("\",\"hr\":"));
    Serial.print(beatAvg);
    Serial.print(F(",\"spo2\":"));
    Serial.print(spo2Value);
    Serial.print(F(",\"temp\":"));
    Serial.print(temperatureC, 1);
    Serial.print(F(",\"ecg\":"));
    Serial.print(ecgRaw);
    Serial.print(F(",\"leadsOff\":"));
    Serial.print(ecgLeadsOff ? F("true") : F("false"));
    Serial.println(F("}"));
  }

  // 6. Refresh Mini OLED Display at ~8 FPS
  if (now - lastOledUpdateMs >= 125) {
    lastOledUpdateMs = now;
    updateMiniOled();
  }
}
