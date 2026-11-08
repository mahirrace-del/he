/**
 * BioSense AI — Multi-Mode ESP32 Telemetry Connector
 * ===================================================
 * Seamlessly interfaces with ESP32 hardware via 4 interchangeable channels:
 * 1. 🌐 Cloud Internet Stream (Server-Sent Events using unique ESP Device ID)
 * 2. 📶 Direct Local Wi-Fi WebSocket (ws://<ESP-IP>:81)
 * 3. 🔌 Direct USB WebSerial (Browser native WebSerial API at 115200 baud)
 * 4. 🧪 Realistic Interactive Simulator (for instant zero-hardware testing)
 */

class EspConnector {
  constructor(options = {}) {
    this.options = Object.assign({
      onTelemetry: null,        // callback(packet)
      onConnectionChange: null, // callback({ status, mode, deviceId, error })
      defaultDeviceId: 'ROBOBEE-HEALTH-01'
    }, options);

    this.mode = 'cloud'; // 'cloud' | 'websocket' | 'webserial' | 'simulator'
    this.deviceId = this.options.defaultDeviceId;
    this.isConnected = false;
    this.packetCount = 0;
    this.lastPacketTime = 0;

    // Handles
    this.sseSource = null;
    this.wsSocket = null;
    this.serialPort = null;
    this.serialReader = null;
    this.simInterval = null;

    // Simulated heart state
    this.simHeartPhase = 0;
    this.simBpm = 76;
    this.simSpo2 = 98;
    this.simTemp = 36.6;
  }

  setDeviceId(id) {
    if (!id) return;
    this.deviceId = id.trim().toUpperCase();
    if (this.mode === 'cloud' && this.isConnected) {
      // Reconnect with new station ID
      this.disconnect();
      this.connectCloud(this.deviceId);
    }
  }

  // ---------------- MODE 1: CLOUD INTERNET STREAM (SSE) ----------------
  connectCloud(deviceId) {
    this.disconnect();
    this.mode = 'cloud';
    this.deviceId = (deviceId || this.deviceId || 'ROBOBEE-HEALTH-01').trim().toUpperCase();

    try {
      const streamUrl = `/api/stream?deviceId=${encodeURIComponent(this.deviceId)}`;
      this.sseSource = new EventSource(streamUrl);

      this.sseSource.onopen = () => {
        this.isConnected = true;
        this.emitStatus('connected', `Streaming from Cloud Station: ${this.deviceId}`);
      };

      this.sseSource.onmessage = (event) => {
        try {
          const packet = JSON.parse(event.data);
          this.handlePacket(packet);
        } catch {
          // ignore heartbeats/comments
        }
      };

      this.sseSource.onerror = (err) => {
        console.warn('SSE Stream status/reconnecting:', err);
        this.emitStatus('reconnecting', 'Cloud connection reconnecting...');
      };
    } catch (err) {
      this.emitStatus('error', err.message);
    }
  }

  // ---------------- MODE 2: DIRECT Wi-Fi LAN WEBSOCKET ----------------
  connectWebSocket(ipAddress, port = 81) {
    this.disconnect();
    this.mode = 'websocket';
    const wsUrl = `ws://${ipAddress}:${port}`;

    try {
      this.wsSocket = new WebSocket(wsUrl);

      this.wsSocket.onopen = () => {
        this.isConnected = true;
        this.emitStatus('connected', `Connected via Local Wi-Fi: ${wsUrl}`);
      };

      this.wsSocket.onmessage = (event) => {
        try {
          const packet = JSON.parse(event.data);
          this.handlePacket(packet);
        } catch (err) {
          console.warn('WS JSON parse error:', err);
        }
      };

      this.wsSocket.onclose = () => {
        this.isConnected = false;
        this.emitStatus('disconnected', 'Local Wi-Fi WebSocket disconnected');
      };

      this.wsSocket.onerror = (err) => {
        this.emitStatus('error', 'Could not connect to ESP32 IP. Ensure you are on the same Wi-Fi network.');
      };
    } catch (err) {
      this.emitStatus('error', err.message);
    }
  }

  // ---------------- MODE 3: DIRECT USB WEBSERIAL ----------------
  async connectWebSerial() {
    this.disconnect();
    this.mode = 'webserial';

    if (!('serial' in navigator)) {
      this.emitStatus('error', 'WebSerial is not supported in this browser. Please use Google Chrome or Microsoft Edge.');
      return false;
    }

    try {
      this.serialPort = await navigator.serial.requestPort();
      await this.serialPort.open({ baudRate: 115200 });
      this.isConnected = true;
      this.emitStatus('connected', 'Connected directly via USB Serial (115200 baud)');

      const textDecoder = new TextDecoderStream();
      const readableStreamClosed = this.serialPort.readable.pipeTo(textDecoder.writable);
      const reader = textDecoder.readable.getReader();
      this.serialReader = reader;

      let buffer = '';
      (async () => {
        while (this.isConnected) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            buffer += value;
            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep remainder
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                try {
                  const packet = JSON.parse(trimmed);
                  this.handlePacket(packet);
                } catch {
                  // ignore non-json
                }
              }
            }
          }
        }
      })();

      return true;
    } catch (err) {
      this.isConnected = false;
      this.emitStatus('error', err.message);
      return false;
    }
  }

  // ---------------- MODE 4: REALISTIC SIMULATION ----------------
  startSimulator() {
    this.disconnect();
    this.mode = 'simulator';
    this.isConnected = true;
    this.emitStatus('connected', 'Interactive Simulation Mode Active (Realistic Biosignals)');

    let sampleCounter = 0;

    this.simInterval = setInterval(() => {
      sampleCounter++;
      const now = performance.now();

      // Cardiac phase (75 BPM = 1.25 Hz = ~800ms cycle)
      const cycleMs = (60 / this.simBpm) * 1000;
      const phase = (now % cycleMs) / cycleMs; // 0.0 to 1.0

      // Synthesize authentic P-Q-R-S-T ECG Waveform
      let ecg = 2048; // isoelectric baseline
      if (phase >= 0.10 && phase < 0.18) {
        // P-wave (Atrial Depolarization)
        ecg += Math.sin(((phase - 0.10) / 0.08) * Math.PI) * 160;
      } else if (phase >= 0.22 && phase < 0.24) {
        // Q-dip
        ecg -= 140;
      } else if (phase >= 0.24 && phase < 0.28) {
        // R-peak (Ventricular Depolarization)
        ecg += 1100;
      } else if (phase >= 0.28 && phase < 0.31) {
        // S-dip
        ecg -= 380;
      } else if (phase >= 0.40 && phase < 0.58) {
        // T-wave (Ventricular Repolarization)
        ecg += Math.sin(((phase - 0.40) / 0.18) * Math.PI) * 260;
      }

      // Add gentle baseline drift & micro noise
      ecg += Math.sin(sampleCounter * 0.04) * 40 + (Math.random() - 0.5) * 25;

      // Realistic respiration wave on SpO2 and Temp
      const packet = {
        deviceId: 'SIMULATOR-01',
        hr: Math.round(this.simBpm + Math.sin(now * 0.001) * 3),
        spo2: Math.round(this.simSpo2 - Math.abs(Math.sin(now * 0.0005) * 1)),
        temp: Number((this.simTemp + Math.sin(now * 0.0002) * 0.1).toFixed(1)),
        ecg: Math.round(ecg),
        leadsOff: false,
        finger: true
      };

      this.handlePacket(packet);
    }, 40); // 25 Hz
  }

  // ---------------- TELEMETRY DISPATCH ----------------
  handlePacket(packet) {
    this.packetCount++;
    this.lastPacketTime = performance.now();

    if (typeof this.options.onTelemetry === 'function') {
      this.options.onTelemetry(packet);
    }
  }

  // ---------------- BIDIRECTIONAL FEEDBACK TO ESP32 ----------------
  async sendFaceFeedback(faceData) {
    const payload = {
      deviceId: this.deviceId,
      mood: faceData.mood || 'CALM',
      pct: faceData.moodPct || 85,
      condition: faceData.condition || 'RESTED',
      vitality: faceData.vitality || 90
    };

    // 1. Send via Cloud HTTP Relay
    try {
      fetch('/api/face-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => {});
    } catch {}

    // 2. Send via Direct WebSocket if active
    if (this.mode === 'websocket' && this.wsSocket && this.wsSocket.readyState === WebSocket.OPEN) {
      const line = `${payload.mood},${payload.pct},${payload.condition},${payload.vitality}\n`;
      this.wsSocket.send(line);
    }

    // 3. Send via USB WebSerial if active
    if (this.mode === 'webserial' && this.serialPort && this.serialPort.writable) {
      try {
        const textEncoder = new TextEncoderStream();
        textEncoder.readable.pipeTo(this.serialPort.writable);
        const writer = textEncoder.writable.getWriter();
        const line = `${payload.mood},${payload.pct},${payload.condition},${payload.vitality}\n`;
        await writer.write(line);
        writer.releaseLock();
      } catch {}
    }
  }

  emitStatus(status, message) {
    if (typeof this.options.onConnectionChange === 'function') {
      this.options.onConnectionChange({
        status,
        mode: this.mode,
        deviceId: this.deviceId,
        message
      });
    }
  }

  disconnect() {
    this.isConnected = false;

    if (this.sseSource) {
      this.sseSource.close();
      this.sseSource = null;
    }
    if (this.wsSocket) {
      this.wsSocket.close();
      this.wsSocket = null;
    }
    if (this.serialReader) {
      try { this.serialReader.cancel(); } catch {}
      this.serialReader = null;
    }
    if (this.serialPort) {
      try { this.serialPort.close(); } catch {}
      this.serialPort = null;
    }
    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
    }

    this.emitStatus('disconnected', 'Disconnected');
  }
}

if (typeof window !== 'undefined') {
  window.EspConnector = EspConnector;
}
