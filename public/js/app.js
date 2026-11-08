/**
 * BioSense AI — School Health Kiosk Master Application Controller
 * ===============================================================
 * Coordinates:
 * - Station Pairing & Multi-Mode Connection (Cloud SSE, Wi-Fi WS, WebSerial, Simulator)
 * - 6-Step Clinical Checkup Workflow
 * - Sensor Telemetry Aggregation & 20s Clinical Averaging Session
 * - Laptop Webcam Facial Expression AI & Snapshot Capture
 * - Standard Value Comparison & Scoring
 * - Report Card Generation, Printing, & Multi-Week History
 */

const App = {
  // Application State
  currentStep: 1, // 1 to 6
  activeTab: 'checkup', // 'checkup' | 'history' | 'stations'

  // Hardware Connection
  connector: null,
  oscilloscope: null,
  faceAI: null,

  // Current Student Intake
  student: {
    name: "",
    studentId: "",
    grade: "Class 7",
    age: 13,
    gender: "Male",
    questionnaire: {
      sleepHours: "8+",
      feelSick: "no",
      breakfast: "yes",
      chestPain: "no",
      symptomsNotes: ""
    }
  },

  // Telemetry Session State (20s Clinical Recording)
  recording: {
    isActive: false,
    timerSeconds: 20,
    timerInterval: null,
    heartRateSamples: [],
    spo2Samples: [],
    tempSamples: [],
    ecgRawSamples: [],
    leadOffCount: 0,
    snapshotPhotoUrl: null,
    ecgSnapshotUrl: null
  },

  // Latest Live Reading
  live: {
    hr: 0,
    spo2: 0,
    temp: 36.6,
    ecg: 2048,
    leadsOff: false,
    finger: false
  },

  // Generated Report
  lastReport: null,

  init() {
    console.log('BioSense AI Health Kiosk Initializing...');

    // 1. Initialize ECG Oscilloscope
    this.oscilloscope = new EcgOscilloscope('ecgCanvas', {
      traceColor: '#10B981',
      bgColor: '#0B131E',
      soundEnabled: false
    });

    // 1b. Initialize Persistent Top Mini-ECG Banner
    this.initPersistentMiniEcg();

    // 2. Initialize Facial AI
    this.faceAI = new FaceStressAI('webcamVideo', 'faceOverlayCanvas', {
      onAnalysisUpdate: (state) => this.onFaceAIUpdate(state)
    });

    // 3. Initialize ESP Telemetry Connector (Default to Cloud Mode)
    this.connector = new EspConnector({
      onTelemetry: (packet) => this.onTelemetryReceived(packet),
      onConnectionChange: (status) => this.onConnectionStateChange(status),
      defaultDeviceId: 'ROBOBEE-HEALTH-01'
    });

    // Connect to Cloud SSE by default
    this.connector.connectCloud('ROBOBEE-HEALTH-01');

    // 4. Bind UI Event Handlers
    this.bindEvents();

    // 5. Start Station Scanner
    this.pollActiveStations();
    setInterval(() => this.pollActiveStations(), 4000);

    // 6. Pre-load sample student list
    this.loadStudentsDropdown();
  },

  bindEvents() {
    // Mode Switcher buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mode = btn.dataset.mode;
        this.switchConnectionMode(mode);
      });
    });

    // Station ID input change
    const stationInput = document.getElementById('stationIdInput');
    if (stationInput) {
      stationInput.addEventListener('change', (e) => {
        this.connector.setDeviceId(e.target.value);
      });
    }

    // Audio beep toggle
    const soundToggle = document.getElementById('soundToggleBtn');
    if (soundToggle) {
      soundToggle.addEventListener('click', () => {
        const enabled = this.oscilloscope.toggleSound(!this.oscilloscope.soundEnabled);
        soundToggle.classList.toggle('active', enabled);
        soundToggle.innerText = enabled ? '🔊 Pulse Sound ON' : '🔈 Pulse Sound OFF';
      });
    }

    // Questionnaire radio buttons sync
    document.querySelectorAll('input[type="radio"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        const name = e.target.name;
        const val = e.target.value;
        if (name in this.student.questionnaire) {
          this.student.questionnaire[name] = val;
        }
      });
    });

    // Navigation Tabs (Checkup vs History)
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        this.switchTab(target);
      });
    });
  },

  switchTab(tabName) {
    this.activeTab = tabName;
    document.querySelectorAll('.nav-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });

    document.querySelectorAll('.app-view').forEach(v => {
      v.classList.toggle('active', v.id === `view-${tabName}`);
    });

    if (tabName === 'history') {
      const currentId = this.student.studentId || document.getElementById('inputStudentId')?.value;
      if (currentId) {
        document.getElementById('historySearchInput').value = currentId;
        this.searchHistory(currentId);
      }
    }
  },

  // ---------------- CONNECTION & TELEMETRY ----------------

  switchConnectionMode(mode) {
    document.querySelectorAll('.mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });

    const stationId = document.getElementById('stationIdInput')?.value || 'ROBOBEE-HEALTH-01';

    if (mode === 'cloud') {
      this.connector.connectCloud(stationId);
    } else if (mode === 'simulator') {
      this.connector.startSimulator();
    } else if (mode === 'webserial') {
      this.connector.connectWebSerial();
    } else if (mode === 'websocket') {
      const ip = prompt('Enter ESP32 Local IP Address (shown on OLED screen, e.g. 192.168.1.105):', '192.168.1.105');
      if (ip) {
        this.connector.connectWebSocket(ip.trim(), 81);
      }
    }
  },

  onConnectionStateChange(info) {
    const badge = document.getElementById('stationStatusBadge');
    const label = document.getElementById('stationStatusLabel');

    if (info.status === 'connected') {
      badge.className = 'status-indicator status-online';
      label.innerText = `Connected: ${info.deviceId} (${info.mode.toUpperCase()})`;
    } else if (info.status === 'reconnecting') {
      badge.className = 'status-indicator status-standby';
      label.innerText = `Reconnecting to ${info.deviceId}...`;
    } else {
      badge.className = 'status-indicator status-offline';
      label.innerText = 'Station Disconnected';
    }
  },

  onTelemetryReceived(packet) {
    this.live = {
      hr: packet.hr || 0,
      spo2: packet.spo2 || 0,
      temp: packet.temp || 36.6,
      ecg: packet.ecg || 2048,
      leadsOff: Boolean(packet.leadsOff),
      finger: Boolean(packet.finger)
    };

    // Feed real-time sample into ECG canvas
    if (this.oscilloscope) {
      this.oscilloscope.pushSample(this.live.ecg, this.live.leadsOff);
    }

    // Feed persistent top mini-oscilloscope
    this.pushMiniEcgSample(this.live.ecg, this.live.leadsOff);
    this.updatePersistentTelemetryStrip();

    // Update Live Meters in Step 3
    this.updateLiveMetricUI();

    // If recording session is active, accumulate clinical samples
    if (this.recording.isActive) {
      if (this.live.hr > 40 && this.live.hr < 200) {
        this.recording.heartRateSamples.push(this.live.hr);
      }
      if (this.live.spo2 > 70 && this.live.spo2 <= 100) {
        this.recording.spo2Samples.push(this.live.spo2);
      }
      if (this.live.temp > 25 && this.live.temp < 45) {
        this.recording.tempSamples.push(this.live.temp);
      }
      if (this.live.leadsOff) {
        this.recording.leadOffCount++;
      }
    }

    // Check sensor placement badges in Step 2
    if (this.currentStep === 2) {
      this.updateStep2HardwareChecklist();
    }
  },

  updateLiveMetricUI() {
    // Heart Rate
    const hrVal = document.getElementById('liveHeartRateVal');
    if (hrVal) {
      hrVal.innerText = this.live.hr > 0 ? this.live.hr : '--';
    }

    // SpO2
    const spo2Val = document.getElementById('liveSpo2Val');
    if (spo2Val) {
      spo2Val.innerText = this.live.spo2 > 0 ? `${this.live.spo2}%` : '--%';
    }

    // Temperature
    const tempVal = document.getElementById('liveTempVal');
    const tempFVal = document.getElementById('liveTempFVal');
    if (tempVal) {
      tempVal.innerText = `${this.live.temp.toFixed(1)}°C`;
    }
    if (tempFVal) {
      const f = (this.live.temp * 9 / 5) + 32;
      tempFVal.innerText = `${f.toFixed(1)}°F`;
    }

    // Leads-Off Alert Badge
    const leadsBadge = document.getElementById('liveLeadsBadge');
    if (leadsBadge) {
      leadsBadge.style.display = this.live.leadsOff ? 'inline-block' : 'none';
    }
  },

  initPersistentMiniEcg() {
    this.miniCanvas = document.getElementById('persistentMiniEcg');
    if (!this.miniCanvas) return;
    this.miniCtx = this.miniCanvas.getContext('2d');
    this.miniWidth = 240;
    this.miniHeight = 42;
    this.miniBuf = new Float32Array(this.miniWidth).fill(21);
    this.miniSweep = 0;
    this.miniBaseline = 2048;

    const renderMini = () => {
      if (!this.miniCtx) return;
      const ctx = this.miniCtx;
      const w = this.miniWidth;
      const h = this.miniHeight;

      ctx.fillStyle = '#080D14';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = 'rgba(16, 185, 129, 0.14)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
      ctx.stroke();

      ctx.strokeStyle = '#10B981';
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const y = this.miniBuf[x] || (h / 2);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      requestAnimationFrame(renderMini);
    };
    requestAnimationFrame(renderMini);
  },

  pushMiniEcgSample(rawVal, leadsOff) {
    if (!this.miniBuf) return;
    this.miniBaseline = this.miniBaseline * 0.96 + rawVal * 0.04;
    const diff = rawVal - this.miniBaseline;
    const midY = 21;
    let y = midY - (diff * (16 / 350));
    if (leadsOff && Math.abs(diff) < 20) y = midY;
    y = Math.max(2, Math.min(40, y));

    this.miniBuf[this.miniSweep] = y;
    this.miniSweep = (this.miniSweep + 1) % this.miniWidth;
  },

  updatePersistentTelemetryStrip() {
    const hr = document.getElementById('topLiveHr');
    if (hr) hr.innerText = this.live.hr > 0 ? this.live.hr : '--';

    const spo2 = document.getElementById('topLiveSpo2');
    if (spo2) spo2.innerText = this.live.spo2 > 0 ? `${this.live.spo2}%` : '--%';

    const temp = document.getElementById('topLiveTemp');
    if (temp) temp.innerText = `${this.live.temp.toFixed(1)}°C`;

    const ecgState = document.getElementById('topLiveEcgState');
    if (ecgState) {
      if (this.live.leadsOff) {
        ecgState.innerText = 'LEADS OFF';
        ecgState.className = 'tag-status alert';
      } else {
        ecgState.innerText = 'ECG: OK';
        ecgState.className = 'tag-status';
      }
    }
  },

  onFaceAIUpdate(state) {
    // Relay facial AI mood back to the ESP32 (updates mini OLED)
    if (this.connector && state.faceDetected) {
      this.connector.sendFaceFeedback(state);
    }

    // Update UI Badges in Step 4
    const moodBadge = document.getElementById('faceMoodBadge');
    if (moodBadge) {
      moodBadge.innerText = `${state.mood} (${state.moodPct}%)`;
      moodBadge.className = `hud-badge badge-${state.mood === 'HAPPY' ? 'amber' : (state.mood === 'DEPRESSED' || state.mood === 'STRESSED' ? 'rose' : 'emerald')}`;
    }

    const stressBadge = document.getElementById('faceStressBadge');
    if (stressBadge) {
      stressBadge.innerText = `Stress: ${state.stressScore}%`;
      stressBadge.className = `hud-badge badge-${state.stressScore > 50 ? 'rose' : (state.stressScore > 30 ? 'amber' : 'emerald')}`;
    }

    const vitalityBadge = document.getElementById('faceVitalityBadge');
    if (vitalityBadge) {
      vitalityBadge.innerText = `Vitality: ${state.vitality}/100`;
    }

    // Dermatology: Pallor / Anemia Badge
    const pallorBadge = document.getElementById('facePallorBadge');
    if (pallorBadge) {
      if (state.pallorDetected) {
        pallorBadge.innerText = `⚠️ Pallor Alert (${state.pallorScore}%)`;
        pallorBadge.className = 'hud-badge badge-amber';
      } else {
        pallorBadge.innerText = `Healthy Perfusion (${state.perfusionRatio}x) ✔`;
        pallorBadge.className = 'hud-badge badge-emerald';
      }
    }

    // Dermatology: Jaundice / Bilirubin Badge
    const jaundiceBadge = document.getElementById('faceJaundiceBadge');
    if (jaundiceBadge) {
      if (state.jaundiceDetected) {
        jaundiceBadge.innerText = `⚠️ Scleral Yellow Alert (YI: ${state.yellowIndex})`;
        jaundiceBadge.className = 'hud-badge badge-rose';
      } else {
        jaundiceBadge.innerText = `Clean Sclera (YI: ${state.yellowIndex}) ✔`;
        jaundiceBadge.className = 'hud-badge badge-emerald';
      }
    }

    // Affect & Depression Risk Badge
    const affectBadge = document.getElementById('faceAffectBadge');
    if (affectBadge) {
      affectBadge.innerText = `${state.depressionRisk} (${state.affectStatus})`;
      affectBadge.className = `hud-badge badge-${state.depressionRisk?.includes('Elevated') ? 'rose' : (state.depressionRisk?.includes('Moderate') ? 'amber' : 'emerald')}`;
    }

    // Clinical Summary Box
    const summaryBox = document.getElementById('faceClinicalSummary');
    if (summaryBox) {
      summaryBox.innerText = state.clinicalAssessment;
    }
  },

  async pollActiveStations() {
    try {
      const res = await fetch('/api/stations');
      const data = await res.json();
      const select = document.getElementById('stationQuickSelect');
      if (!select || !data.stations) return;

      const currentVal = select.value;
      select.innerHTML = '<option value="">-- Detected Online Stations --</option>';

      data.stations.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.deviceId;
        opt.innerText = `${s.deviceId} [${s.isOnline ? '🟢 Live' : '⚪ Standby'}]`;
        select.appendChild(opt);
      });

      if (currentVal) select.value = currentVal;
    } catch {}
  },

  // ---------------- 6-STEP WORKFLOW CONTROLLER ----------------

  goToStep(stepNum) {
    if (stepNum < 1 || stepNum > 6) return;

    // Validate step 1 before proceeding
    if (this.currentStep === 1 && stepNum > 1) {
      const nameInput = document.getElementById('inputStudentName');
      const idInput = document.getElementById('inputStudentId');

      if (!nameInput.value.trim() || !idInput.value.trim()) {
        alert('Please enter Student Name and Student ID to begin the health checkup.');
        return;
      }

      this.student.name = nameInput.value.trim();
      this.student.studentId = idInput.value.trim().toUpperCase();
      this.student.grade = document.getElementById('inputGrade').value;
      this.student.age = Number(document.getElementById('inputAge').value) || 13;
      this.student.gender = document.getElementById('inputGender').value;
    }

    this.currentStep = stepNum;

    // Update stepper pills
    document.querySelectorAll('.step-pill').forEach((pill, idx) => {
      const n = idx + 1;
      pill.classList.toggle('active', n === stepNum);
      pill.classList.toggle('completed', n < stepNum);
    });

    // Update step cards
    document.querySelectorAll('.step-card').forEach((card) => {
      const n = Number(card.dataset.step);
      card.classList.toggle('active', n === stepNum);
    });

    // Step-specific activations
    if (stepNum === 4) {
      // Step 4: Start Webcam Facial AI
      this.faceAI.startCamera();
      // Ensure ECG snapshot was taken
      if (!this.recording.ecgSnapshotUrl && this.oscilloscope) {
        this.recording.ecgSnapshotUrl = this.oscilloscope.captureSnapshot();
      }
    }

    if (stepNum === 3) {
      // Step 3: Auto-start or prompt for 20s recording
      this.resetRecordingSession();
      // Force canvas resize now that container is visible in DOM
      if (this.oscilloscope) {
        this.oscilloscope.resize();
        setTimeout(() => this.oscilloscope.resize(), 80);
      }
    }

    if (stepNum === 5) {
      // Ensure both snapshots exist
      if (!this.recording.ecgSnapshotUrl && this.oscilloscope) {
        this.recording.ecgSnapshotUrl = this.oscilloscope.captureSnapshot();
      }
      if (!this.recording.snapshotPhotoUrl && this.faceAI && this.faceAI.isActive) {
        this.recording.snapshotPhotoUrl = this.faceAI.captureStudentPhoto();
      }
      // Step 5: Evaluate Standards & Show Review
      this.generateHealthReview();
    }

    if (stepNum === 6) {
      // Step 6: Final Report Card Presentation
      if (!this.lastReport) {
        this.generateHealthReview();
      }
      this.presentFinalReport();
    }

    // Scroll to top of card
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  updateStep2HardwareChecklist() {
    // Pulse Oximeter Finger
    const oximeterCheck = document.getElementById('chkOximeter');
    if (oximeterCheck) {
      const ok = this.live.finger || this.live.hr > 0;
      oximeterCheck.className = ok ? 'check-item ready' : 'check-item waiting';
      oximeterCheck.querySelector('.status-text').innerText = ok ? 'Finger Detected ✔' : 'Waiting for finger...';
    }

    // ECG Leads
    const ecgCheck = document.getElementById('chkEcg');
    if (ecgCheck) {
      const ok = !this.live.leadsOff;
      ecgCheck.className = ok ? 'check-item ready' : 'check-item waiting';
      ecgCheck.querySelector('.status-text').innerText = ok ? 'Electrodes Connected ✔' : 'Leads Off / Check pads';
    }

    // Temp Sensor
    const tempCheck = document.getElementById('chkTemp');
    if (tempCheck) {
      const ok = this.live.temp > 25;
      tempCheck.className = ok ? 'check-item ready' : 'check-item waiting';
      tempCheck.querySelector('.status-text').innerText = ok ? `Reading (${this.live.temp.toFixed(1)}°C) ✔` : 'Calibrating...';
    }
  },

  // ---------------- STEP 3: 20s CLINICAL RECORDING ----------------

  resetRecordingSession() {
    this.recording = {
      isActive: false,
      timerSeconds: 20,
      timerInterval: null,
      heartRateSamples: [],
      spo2Samples: [],
      tempSamples: [],
      ecgRawSamples: [],
      leadOffCount: 0,
      snapshotPhotoUrl: null,
      ecgSnapshotUrl: null
    };

    document.getElementById('recordingTimerText').innerText = '20s';
    document.getElementById('recordingProgressBar').style.width = '0%';
    document.getElementById('startRecordingBtn').style.display = 'inline-flex';
    document.getElementById('recordingActiveBadge').style.display = 'none';
    document.getElementById('proceedToFaceBtn').style.display = 'none';
  },

  startClinicalRecording() {
    this.resetRecordingSession();
    this.recording.isActive = true;

    document.getElementById('startRecordingBtn').style.display = 'none';
    document.getElementById('recordingActiveBadge').style.display = 'inline-flex';

    let elapsed = 0;
    const total = 20;

    this.recording.timerInterval = setInterval(() => {
      elapsed++;
      const remaining = total - elapsed;
      document.getElementById('recordingTimerText').innerText = `${remaining}s`;

      const pct = (elapsed / total) * 100;
      document.getElementById('recordingProgressBar').style.width = `${pct}%`;

      if (elapsed >= total) {
        clearInterval(this.recording.timerInterval);
        this.recording.isActive = false;
        this.finishRecording();
      }
    }, 1000);
  },

  finishRecording() {
    // Capture ECG strip snapshot
    if (this.oscilloscope) {
      this.recording.ecgSnapshotUrl = this.oscilloscope.captureSnapshot();
    }

    document.getElementById('recordingActiveBadge').style.display = 'none';
    document.getElementById('recordingTimerText').innerText = 'Complete ✔';
    document.getElementById('proceedToFaceBtn').style.display = 'inline-flex';
  },

  // ---------------- STEP 4: WEBCAM SNAPSHOT & PROCEED ----------------

  captureStudentPhotoAndProceed() {
    // Capture high-res webcam snapshot
    if (this.faceAI) {
      this.recording.snapshotPhotoUrl = this.faceAI.captureStudentPhoto();
    }
    // Ensure ECG strip snapshot exists
    if (!this.recording.ecgSnapshotUrl && this.oscilloscope) {
      this.recording.ecgSnapshotUrl = this.oscilloscope.captureSnapshot();
    }
    this.goToStep(5);
  },

  // ---------------- STEP 5: MEDICAL STANDARD COMPARISON ----------------

  generateHealthReview() {
    // Calculate Averages from accumulated clinical recording
    const hrArr = this.recording.heartRateSamples;
    const spo2Arr = this.recording.spo2Samples;
    const tempArr = this.recording.tempSamples;

    const avgHr = hrArr.length > 0 ? Math.round(hrArr.reduce((a, b) => a + b, 0) / hrArr.length) : (this.live.hr || 75);
    const avgSpo2 = spo2Arr.length > 0 ? Math.round(spo2Arr.reduce((a, b) => a + b, 0) / spo2Arr.length) : (this.live.spo2 || 98);
    const avgTemp = tempArr.length > 0 ? Number((tempArr.reduce((a, b) => a + b, 0) / tempArr.length).toFixed(1)) : this.live.temp;

    // Guaranteed fallback snapshots
    if (!this.recording.ecgSnapshotUrl && this.oscilloscope) {
      this.recording.ecgSnapshotUrl = this.oscilloscope.captureSnapshot();
    }
    if (!this.recording.snapshotPhotoUrl && this.faceAI && this.faceAI.isActive) {
      this.recording.snapshotPhotoUrl = this.faceAI.captureStudentPhoto();
    }

    const sessionPayload = {
      avgHeartRate: avgHr,
      avgSpO2: avgSpo2,
      avgTemp: avgTemp,
      faceAnalysis: {
        ...this.faceAI.state
      },
      questionnaire: this.student.questionnaire
    };

    // Run comparison through Pediatric Medical Standards Engine
    const evalResult = MedicalStandards.generateComprehensiveReport(sessionPayload);

    // Save final report object
    this.lastReport = {
      id: 'CHK-' + Date.now(),
      studentName: this.student.name,
      studentId: this.student.studentId,
      grade: this.student.grade,
      age: this.student.age,
      gender: this.student.gender,
      deviceId: this.connector?.deviceId || 'ROBOBEE-HEALTH-01',
      timestamp: Date.now(),
      vitals: {
        avgHeartRate: avgHr,
        avgSpO2: avgSpo2,
        avgTemp: avgTemp,
        avgTempF: (avgTemp * 9 / 5) + 32,
        leadsOff: this.recording.leadOffCount > 5
      },
      evaluations: evalResult.evaluations,
      healthScore: evalResult.score,
      healthStatus: evalResult.overallStatus,
      statusClass: evalResult.statusClass,
      bannerColor: evalResult.bannerColor,
      recommendations: evalResult.recommendations,
      faceAnalysis: {
        ...this.faceAI.state,
        photoSnapshot: this.recording.snapshotPhotoUrl
      },
      ecgSnapshotUrl: this.recording.ecgSnapshotUrl,
      questionnaire: this.student.questionnaire
    };

    // Render Step 5 Review Cards
    this.renderStep5Review(this.lastReport);
  },

  renderStep5Review(report) {
    const container = document.getElementById('step5ComparisonContainer');
    if (!container) return;

    const e = report.evaluations;

    container.innerHTML = `
      <div class="score-summary-banner banner-${report.bannerColor}">
        <div class="score-number">${report.healthScore}<span>/100</span></div>
        <div class="score-text">
          <h2>${report.healthStatus}</h2>
          <p>Assessed against WHO & American Academy of Pediatrics (AAP) adolescent clinical standards.</p>
        </div>
      </div>

      <div class="comparison-cards-grid">
        <div class="comp-card">
          <div class="comp-header">
            <span class="icon">❤️</span>
            <h4>Heart Rate (Pulse)</h4>
            <span class="status-badge badge-${e.heartRate.color}">${e.heartRate.badge}</span>
          </div>
          <div class="val">${report.vitals.avgHeartRate} <span>BPM</span></div>
          <div class="standard-ref">Standard: 60 – 100 BPM</div>
          <p class="desc">${e.heartRate.message}</p>
        </div>

        <div class="comp-card">
          <div class="comp-header">
            <span class="icon">🫁</span>
            <h4>Blood Oxygen (SpO2)</h4>
            <span class="status-badge badge-${e.spo2.color}">${e.spo2.badge}</span>
          </div>
          <div class="val">${report.vitals.avgSpO2} <span>%</span></div>
          <div class="standard-ref">Standard: 95% – 100%</div>
          <p class="desc">${e.spo2.message}</p>
        </div>

        <div class="comp-card">
          <div class="comp-header">
            <span class="icon">🌡️</span>
            <h4>Body Temperature</h4>
            <span class="status-badge badge-${e.temperature.color}">${e.temperature.badge}</span>
          </div>
          <div class="val">${report.vitals.avgTemp.toFixed(1)}°C <span>(${report.vitals.avgTempF.toFixed(1)}°F)</span></div>
          <div class="standard-ref">Standard: 36.5°C – 37.5°C</div>
          <p class="desc">${e.temperature.message}</p>
        </div>

        <div class="comp-card">
          <div class="comp-header">
            <span class="icon">🧠</span>
            <h4>Facial Stress & Mood</h4>
            <span class="status-badge badge-${e.stressAndMood.color}">${e.stressAndMood.badge}</span>
          </div>
          <div class="val">${report.faceAnalysis.mood} <span>(Stress: ${report.faceAnalysis.stressScore}%)</span></div>
          <div class="standard-ref">Vitality Score: ${report.faceAnalysis.vitality}/100</div>
          <p class="desc">${e.stressAndMood.message}</p>
        </div>
      </div>

      <div class="recommendations-preview-box">
        <h3>Clinical Recommendations for School Nurse & Student:</h3>
        <ul>
          ${report.recommendations.map(r => `<li>${r}</li>`).join('')}
        </ul>
      </div>
    `;
  },

  // ---------------- STEP 6: REPORT CARD & PERSISTENCE ----------------

  async presentFinalReport() {
    if (!this.lastReport) {
      this.generateHealthReview();
    }

    // Ensure ECG snapshot is always present
    if ((!this.lastReport.ecgSnapshotUrl || this.lastReport.ecgSnapshotUrl.length < 50) && this.oscilloscope) {
      this.lastReport.ecgSnapshotUrl = this.oscilloscope.captureSnapshot();
    }
    // Ensure photo snapshot is present if camera was active
    if (!this.lastReport.faceAnalysis.photoSnapshot && this.faceAI && this.faceAI.isActive) {
      this.lastReport.faceAnalysis.photoSnapshot = this.faceAI.captureStudentPhoto();
    }

    // Render report card HTML immediately into container
    const container = document.getElementById('reportCardRenderArea');
    if (container) {
      container.innerHTML = ReportGenerator.renderReportCardHtml(this.lastReport);
    }

    // Save record to backend in background (never blocks rendering)
    try {
      await ReportGenerator.saveRecord(this.lastReport);
    } catch (err) {
      console.warn('Background record save note:', err);
    }
  },

  printReportCard() {
    window.print();
  },

  startNewStudentCheckup() {
    // Reset questionnaire and inputs
    document.getElementById('inputStudentName').value = '';
    document.getElementById('inputStudentId').value = '';
    this.student.questionnaire = {
      sleepHours: "8+",
      feelSick: "no",
      breakfast: "yes",
      chestPain: "no",
      symptomsNotes: ""
    };
    this.lastReport = null;
    this.goToStep(1);
  },

  // ---------------- MULTI-WEEK HISTORY ----------------

  async searchHistory(queryId) {
    const id = (queryId || document.getElementById('historySearchInput').value || '').trim();
    if (!id) return;

    const records = await ReportGenerator.fetchStudentHistory(id);
    ReportGenerator.renderHistoryView(records, 'historyTableContainer', 'historyTrendCanvas');
  },

  async viewHistoricalRecord(recordId) {
    const list = ReportGenerator.getLocalRecords();
    const rec = list.find(r => r.id === recordId);
    if (!rec) return;

    this.lastReport = rec;
    this.switchTab('checkup');
    this.goToStep(6);
  },

  async loadStudentsDropdown() {
    try {
      const res = await fetch('/api/students');
      const data = await res.json();
      const datalist = document.getElementById('studentsDatalist');
      if (!datalist || !data.students) return;

      datalist.innerHTML = '';
      data.students.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.studentId;
        opt.label = `${s.name} (${s.grade})`;
        datalist.appendChild(opt);
      });
    } catch {}
  }
};

// Start application when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  App.init();
});
