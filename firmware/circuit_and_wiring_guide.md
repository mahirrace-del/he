# BioSense AI — Hardware Wiring & Circuit Guide

This guide documents the complete circuit connections between the **ESP32 DevKit V1**, sensors, and display for the **BioSense AI School Health Kiosk**.

---

## 1. Pin Connection Master Table

| Module / Sensor | Sensor Pin | ESP32 GPIO Pin | Function / Type | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **SSD1306 OLED (128x64)** | VCC | 3.3V (or 5V) | Power | 0.96" I2C Display (Addr: `0x3C`) |
| | GND | GND | Ground | Common Ground |
| | SCL | **GPIO 22** | Hardware I2C Clock | Shared I2C Bus |
| | SDA | **GPIO 21** | Hardware I2C Data | Shared I2C Bus |
| **MAX30102 (Pulse Oximeter)** | VIN / VCC | 3.3V (or 5V mod) | Power | Optical SpO2 & Heart Rate (`0x57`) |
| | GND | GND | Ground | Common Ground |
| | SCL | **GPIO 22** | Hardware I2C Clock | Shared I2C Bus |
| | SDA | **GPIO 21** | Hardware I2C Data | Shared I2C Bus |
| | INT | Not connected | Interrupt | Optional |
| **AD8232 (Single-Lead ECG)** | 3.3V | 3.3V | Power | **DO NOT connect to 5V** (3.3V max) |
| | GND | GND | Ground | Common Ground |
| | OUTPUT | **GPIO 34** | Analog Input (ADC1_CH6) | ADC1 is safe with Wi-Fi active |
| | LO+ (Leads-Off +) | **GPIO 32** | Digital Input | High when positive lead disconnects |
| | LO- (Leads-Off -) | **GPIO 33** | Digital Input | High when negative lead disconnects |
| | SDN (Shutdown) | Not connected | Control | Leave floating (enabled) |
| **TMP36 (Temp Sensor)** | Pin 1 (+Vs) | 3.3V | Power | Left pin with flat face forward |
| | Pin 2 (Vout) | **GPIO 35** | Analog Input (ADC1_CH7) | 10 mV/°C linear analog output |
| | Pin 3 (GND) | GND | Ground | Right pin with flat face forward |

---

## 2. Critical Hardware Rules & Tips

> [!IMPORTANT]
> **Use ADC1 Only**: On ESP32, ADC2 cannot be used when Wi-Fi is active because the Wi-Fi radio driver uses ADC2 internally. That is why:
> - ECG Output is on **GPIO 34** (ADC1_CH6)
> - Temperature is on **GPIO 35** (ADC1_CH7)
> - ECG Leads-off LO+ and LO- are on **GPIO 32 and GPIO 33** (Digital Inputs)

> [!TIP]
> **Shared I2C Bus**:
> Both the SSD1306 Mini OLED (Address `0x3C`) and the MAX30102 Pulse Oximeter (Address `0x57`) share the same I2C lines (`GPIO 21` for SDA and `GPIO 22` for SCL). Wire them in parallel on a breadboard or custom PCB.

---

## 3. AD8232 Electrode Placement (3-Lead Configuration)

For standard student health screening, place the 3 ECG adhesive gel electrodes as follows:

```
          [  HEAD / NECK  ]
                 |
     RA (Red)   / \   LA (Yellow)
    Right Arm  /   \  Left Arm / Under Left Clavicle
   (or chest) /     \
             | BODY  |
             \       /
              \     /
               \   /
              RL (Green / Black)
              Right Leg / Lower Abdomen (Reference Ground)
```

1. **RA (Red)**: Placed on right inner forearm or below right collarbone.
2. **LA (Yellow)**: Placed on left inner forearm or below left collarbone.
3. **RL (Green)**: Placed on right lower abdomen or inner wrist as reference earth ground.

---

## 4. MAX30102 & TMP36 Testing Guidelines

- **MAX30102 Finger Placement**:
  - Rest index finger gently over the optical sensor.
  - **Do NOT press down too hard**, as excessive pressure cuts off microvascular capillary blood flow and ruins the SpO2 reading. Keep gentle, steady contact.
- **TMP36 Temperature Reading**:
  - Hold the metal tab/sensor face between dry index finger and thumb, or against inner wrist for 10-15 seconds to allow thermal conduction to reach equilibrium.
