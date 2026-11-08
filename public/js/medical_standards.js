/**
 * BioSense AI — Pediatric & School Medical Standard Value Comparison Engine
 * =========================================================================
 * Evaluates student vital signs, ECG rhythm, and facial stress levels against
 * WHO, American Academy of Pediatrics (AAP), and pediatric clinical baselines.
 */

const MedicalStandards = {
  // Baseline Reference Ranges for School Students (Ages 10 - 18 / Class 5 - 10)
  standards: {
    heartRate: {
      unit: "BPM",
      optimalMin: 65,
      optimalMax: 85,
      normalMin: 60,
      normalMax: 100,
      bradycardia: 60, // below 60 is low
      tachycardia: 100 // above 100 is high
    },
    spo2: {
      unit: "%",
      optimalMin: 98,
      optimalMax: 100,
      normalMin: 95,
      normalMax: 100,
      mildHypoxia: 91, // 91-94%
      severeHypoxia: 90 // <=90%
    },
    temperature: {
      unitC: "°C",
      unitF: "°F",
      optimalMin: 36.5,
      optimalMax: 37.2,
      normalMin: 36.2,
      normalMax: 37.5,
      hypothermia: 35.8,
      lowGradeFever: 37.6, // 37.6°C - 38.3°C
      highFever: 38.4      // >= 38.4°C
    },
    stressIndex: {
      unit: "/100",
      relaxedMax: 25,
      normalMax: 45,
      elevatedMax: 70,
      severeThreshold: 70
    }
  },

  /**
   * Evaluate a single vital sign against clinical standards
   */
  evaluateHeartRate(bpm) {
    if (!bpm || bpm <= 0) {
      return { status: "unknown", badge: "Not Recorded", color: "gray", message: "No pulse signal detected" };
    }
    if (bpm < this.standards.heartRate.normalMin) {
      return {
        status: "bradycardia",
        badge: "Bradycardia (Low)",
        color: "amber",
        deviation: bpm - this.standards.heartRate.normalMin,
        message: "Heart rate is below standard adolescent resting baseline (<60 BPM). May indicate deep relaxation, athletic conditioning, or lethargy."
      };
    }
    if (bpm > this.standards.heartRate.tachycardia) {
      return {
        status: "tachycardia",
        badge: "Tachycardia (Elevated)",
        color: "rose",
        deviation: bpm - this.standards.heartRate.normalMax,
        message: "Heart rate is above normal resting limits (>100 BPM). Check for recent physical exertion, anxiety, caffeine, dehydration, or fever."
      };
    }
    if (bpm >= this.standards.heartRate.optimalMin && bpm <= this.standards.heartRate.optimalMax) {
      return {
        status: "optimal",
        badge: "Optimal Resting Pulse",
        color: "emerald",
        deviation: 0,
        message: "Pulse is in the ideal resting range for students (65–85 BPM)."
      };
    }
    return {
      status: "normal",
      badge: "Normal Resting Pulse",
      color: "emerald",
      deviation: 0,
      message: "Pulse falls within normal clinical range (60–100 BPM)."
    };
  },

  evaluateSpO2(spo2) {
    if (!spo2 || spo2 <= 0) {
      return { status: "unknown", badge: "Not Recorded", color: "gray", message: "No blood oxygen signal" };
    }
    if (spo2 < this.standards.spo2.mildHypoxia) {
      return {
        status: "critical",
        badge: "Hypoxia Alert",
        color: "rose",
        deviation: spo2 - this.standards.spo2.normalMin,
        message: "Blood oxygen saturation is critically low (<91%). Immediate school nurse evaluation and airway assessment advised."
      };
    }
    if (spo2 < this.standards.spo2.normalMin) {
      return {
        status: "warning",
        badge: "Mild Oxygen Dip",
        color: "amber",
        deviation: spo2 - this.standards.spo2.normalMin,
        message: "Blood oxygen is slightly below standard (91–94%). Check posture, deep breathing, and ensure sensor is seated securely."
      };
    }
    return {
      status: "optimal",
      badge: "Normal Saturation",
      color: "emerald",
      deviation: 0,
      message: "Blood oxygen saturation is healthy and optimal (95–100%)."
    };
  },

  evaluateTemperature(tempC) {
    if (!tempC || tempC <= 0) {
      return { status: "unknown", badge: "Not Recorded", color: "gray", message: "No temperature reading" };
    }
    const tempF = (tempC * 9 / 5) + 32;

    if (tempC < this.standards.temperature.hypothermia) {
      return {
        status: "low",
        badge: "Subnormal Temp",
        color: "blue",
        tempC: tempC.toFixed(1),
        tempF: tempF.toFixed(1),
        message: `Body temperature (${tempC.toFixed(1)}°C / ${tempF.toFixed(1)}°F) is below normal. Ensure student is warm and re-check sensor contact.`
      };
    }
    if (tempC >= this.standards.temperature.highFever) {
      return {
        status: "critical",
        badge: "High Fever",
        color: "rose",
        tempC: tempC.toFixed(1),
        tempF: tempF.toFixed(1),
        message: `High fever detected (${tempC.toFixed(1)}°C / ${tempF.toFixed(1)}°F). Immediate referral to school infirmary and guardian notification required.`
      };
    }
    if (tempC >= this.standards.temperature.lowGradeFever) {
      return {
        status: "warning",
        badge: "Low-Grade Fever",
        color: "amber",
        tempC: tempC.toFixed(1),
        tempF: tempF.toFixed(1),
        message: `Low-grade fever (${tempC.toFixed(1)}°C / ${tempF.toFixed(1)}°F). Provide water, rest student in quiet room, and re-check in 20 minutes.`
      };
    }
    return {
      status: "optimal",
      badge: "Normal Body Temp",
      color: "emerald",
      tempC: tempC.toFixed(1),
      tempF: tempF.toFixed(1),
      message: `Body temperature is completely normal (${tempC.toFixed(1)}°C / ${tempF.toFixed(1)}°F).`
    };
  },

  evaluateStressAndMood(faceResult) {
    const stress = faceResult?.stressScore ?? 25;
    const mood = faceResult?.mood ?? "CALM";
    const condition = faceResult?.condition ?? "RESTED";

    if (stress >= this.standards.stressIndex.severeThreshold) {
      return {
        status: "severe",
        badge: "High Stress / Overwhelm",
        color: "rose",
        stressScore: stress,
        mood,
        message: "Facial micro-expression and vital correlation show elevated stress, high tension, or acute academic fatigue."
      };
    }
    if (stress >= this.standards.stressIndex.normalMax) {
      return {
        status: "moderate",
        badge: "Mild Tension / Fatigue",
        color: "amber",
        stressScore: stress,
        mood,
        message: "Mild stress or drowsiness detected. Student may be lacking sleep or facing exam pressure."
      };
    }
    return {
      status: "optimal",
      badge: "Relaxed & Attentive",
      color: "emerald",
      stressScore: stress,
      mood,
      message: "Student exhibits balanced, positive facial tone and calm emotional baseline."
    };
  },

  /**
   * Generate Full Comprehensive Health Assessment & Composite Score (0 - 100)
   */
  generateComprehensiveReport(sessionData) {
    const hrEval = this.evaluateHeartRate(sessionData.avgHeartRate);
    const spo2Eval = this.evaluateSpO2(sessionData.avgSpO2);
    const tempEval = this.evaluateTemperature(sessionData.avgTemp);
    const moodEval = this.evaluateStressAndMood(sessionData.faceAnalysis);

    // Calculate Composite Health Index Score (0 - 100)
    let score = 100;

    // Heart Rate deduction
    if (hrEval.status === "bradycardia" || hrEval.status === "tachycardia") score -= 15;

    // SpO2 deduction
    if (spo2Eval.status === "critical") score -= 35;
    else if (spo2Eval.status === "warning") score -= 15;

    // Temperature deduction
    if (tempEval.status === "critical") score -= 30;
    else if (tempEval.status === "warning") score -= 15;
    else if (tempEval.status === "low") score -= 10;

    // Stress deduction
    if (moodEval.status === "severe") score -= 15;
    else if (moodEval.status === "moderate") score -= 8;

    // Questionnaire deductions
    const q = sessionData.questionnaire || {};
    if (q.sleepHours === "<5") score -= 8;
    if (q.feelSick === "yes") score -= 10;
    if (q.breakfast === "no") score -= 5;
    if (q.chestPain === "yes") score -= 20;

    score = Math.max(20, Math.min(100, Math.round(score)));

    // Categorize Overall Status
    let overallStatus = "Normal / Healthy";
    let statusClass = "status-good";
    let bannerColor = "emerald";

    if (score >= 88) {
      overallStatus = "Optimal Health & High Vitality";
      statusClass = "status-optimal";
      bannerColor = "emerald";
    } else if (score >= 72) {
      overallStatus = "Normal / Good Health";
      statusClass = "status-good";
      bannerColor = "emerald";
    } else if (score >= 55) {
      overallStatus = "Caution — Rest & Hydration Advised";
      statusClass = "status-warning";
      bannerColor = "amber";
    } else {
      overallStatus = "Requires School Nurse Follow-up";
      statusClass = "status-alert";
      bannerColor = "rose";
    }

    // Generate Tailored Action Recommendations
    const recommendations = [];
    const fa = sessionData.faceAnalysis || {};

    if (tempEval.status === "critical" || tempEval.status === "warning") {
      recommendations.push("Notify school infirmary immediately. Offer oral hydration and monitor temperature curve.");
    }
    if (spo2Eval.status === "critical" || spo2Eval.status === "warning") {
      recommendations.push("Encourage upright seated posture and diaphragmatic breathing; verify clean airway.");
    }
    if (hrEval.status === "tachycardia") {
      recommendations.push("Give 300-500ml room temperature water and allow 10 minutes quiet seated resting before re-check.");
    }
    if (moodEval.status === "severe" || q.sleepHours === "<5") {
      recommendations.push("Counsel on healthy sleep hygiene (target 8 hours nightly) and stress reduction techniques.");
    }
    if (q.breakfast === "no") {
      recommendations.push("Student skipped breakfast today; recommend a healthy light snack from the school cafeteria.");
    }

    // Dermatology & Mental Well-being Recommendations
    if (fa.pallorDetected) {
      recommendations.push("Facial skin perfusion indicates mild pallor. Recommend checking dietary iron intake (spinach, lentils, meat), hydration, and considering a routine pediatric complete blood count (CBC).");
    }
    if (fa.jaundiceDetected) {
      recommendations.push("Scleral and facial colorimetry showed yellowing index. Recommend school clinic follow-up and monitoring for bilirubin elevation or liver fatigue.");
    }
    if (fa.mood === "DEPRESSED" || fa.depressionRisk?.includes("Moderate") || fa.depressionRisk?.includes("Elevated")) {
      recommendations.push("Emotional screening flagged low mood and reduced facial affect variance. Recommend a compassionate check-in with the school guidance counselor, encouraging daily physical activity and peer support.");
    }

    if (recommendations.length === 0) {
      recommendations.push("Student vitals, skin biomarkers, and emotional well-being are fully within optimal pediatric limits. Keep up healthy habits!");
    }

    return {
      score,
      overallStatus,
      statusClass,
      bannerColor,
      evaluations: {
        heartRate: hrEval,
        spo2: spo2Eval,
        temperature: tempEval,
        stressAndMood: moodEval
      },
      recommendations
    };
  }
};

// Expose globally for browser
if (typeof window !== 'undefined') {
  window.MedicalStandards = MedicalStandards;
}
