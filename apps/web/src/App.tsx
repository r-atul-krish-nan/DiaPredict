import { useEffect, useMemo, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const USER_ID = import.meta.env.VITE_USER_ID ?? "demo-user";

const metricLabels: Record<string, string> = {
  steps: "Steps",
  active_calories_burned: "Active Calories",
  total_calories_burned: "Total Calories",
  distance: "Distance",
  heart_rate: "Heart Rate",
  sleep: "Sleep",
  age: "Age",
  blood_glucose: "Blood Glucose",
  blood_pressure_systolic: "Systolic BP",
  blood_pressure_diastolic: "Diastolic BP",
  weight: "Weight",
  body_fat: "Body Fat",
  height: "Height",
  oxygen_saturation: "SpO2",
  hydration: "Water Intake",
  exercise: "Exercise",
  power: "Power",
  speed: "Speed",
  vo2_max: "VO2 Max",
  basal_metabolic_rate: "Basal Metabolic Rate",
  nutrition_energy: "Nutrition Energy"
};

type DashboardSummary = {
  providerConnection: {
    provider: string;
    status: string;
  } | null;
  latestSync: {
    syncedAt: string;
    recordsInserted: number;
  } | null;
  manualFeatures: {
    Glucose?: number;
    BloodPressure?: number;
    BMI?: number;
    Age?: number;
    Daily_Steps?: number;
  } | null;
  diabetesPrediction: {
    label: string;
    riskPercent: number;
    riskLevel: "lower" | "moderate" | "higher";
    confidencePercent: number;
    basedOn: string;
    featureSnapshot: {
      glucose: number;
      bloodPressure: number;
      bmi: number;
      age: number;
      dailySteps: number;
      observationDays: number;
      observedFeatures: string[];
    };
    shapExplanation: {
      basePercent: number;
      contributions: Array<{
        feature: string;
        label: string;
        featureValue: number;
        impactPercent: number;
        direction: "increase" | "decrease" | "neutral";
        observedFromWatch: boolean;
      }>;
    };
    drivers: string[];
    disclaimer: string;
    modelDetails: {
      dataset: string;
      trainedAt: string;
      rocAuc: number;
      accuracy: number;
    };
  };
  latestMetrics: Array<{
    metricType: string;
    value: number;
    unit: string;
    measuredAt: string;
    sourceDevice: string;
    sourceApp: string;
  }>;
  dailySummary: Array<{
    date: string;
    metrics: Record<string, {
      latest: number;
      unit: string;
      count: number;
    }>;
  }>;
};

type TimelineResponse = {
  metricType: string;
  days: number;
  data: Array<{
    id: string;
    metricType: string;
    date?: string;
    endTime: string;
    value: number;
    unit: string;
    sourceDevice: string;
  }>;
};

function formatMetricLabel(metricType: string) {
  return metricLabels[metricType] ?? metricType.replaceAll("_", " ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatDayLabel(value: string) {
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return "--";
  }

  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric"
  }).format(parsed);
}

function getTimelineWindow(metricType: string) {
  if (["weight", "height", "body_fat", "basal_metabolic_rate", "age"].includes(metricType)) {
    return 30;
  }

  return 7;
}

function usesZeroBaseline(metricType: string) {
  return [
    "steps",
    "distance",
    "active_calories_burned",
    "total_calories_burned",
    "nutrition_energy",
    "hydration",
    "exercise"
  ].includes(metricType);
}

function formatRiskTone(riskLevel: DashboardSummary["diabetesPrediction"]["riskLevel"]) {
  if (riskLevel === "higher") return "Higher";
  if (riskLevel === "moderate") return "Moderate";
  return "Lower";
}

function formatImpact(impactPercent: number) {
  const sign = impactPercent > 0 ? "+" : "";
  return `${sign}${impactPercent.toFixed(1)} pts`;
}

function getFeatureUnit(feature: string) {
  const units: Record<string, string> = {
    Glucose: "mg/dL",
    BloodPressure: "mmHg",
    BMI: "kg/m²",
    Age: "years",
    Daily_Steps: "steps/day",
    Sleep: "hours",
    Heart_Rate: "bpm",
    Oxygen: "%",
    Fitness: "sessions",
    Hydration: "L/day"
  };

  return units[feature] ?? "";
}

function formatObservedFeatureValue(feature: string, value: number, observed: boolean, decimals = 1) {
  if (!observed) {
    return "Not available";
  }

  const unit = getFeatureUnit(feature);
  return `${value.toFixed(decimals)}${unit ? ` ${unit}` : ""}`;
}

function formatContributionValue(feature: string, value: number, observed: boolean) {
  if (!observed) {
    return "Not available";
  }

  const unit = getFeatureUnit(feature);
  const decimals = value >= 100 ? 0 : feature === "Hydration" ? 2 : 1;
  return `${value.toFixed(decimals)}${unit ? ` ${unit}` : ""}`;
}

function formatChartNumber(value: number) {
  if (value >= 1000) {
    return value.toFixed(0);
  }

  if (value >= 100) {
    return value.toFixed(0);
  }

  return value.toFixed(1);
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "x-user-id": USER_ID
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export default function App() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [selectedMetric, setSelectedMetric] = useState("steps");
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [editingFeatures, setEditingFeatures] = useState(false);
  const [editableFeatures, setEditableFeatures] = useState<string[]>([]);
  const [showModal, setShowModal] = useState(true);
  const [manualInputs, setManualInputs] = useState<Record<string, string>>({});
  
  const [simulatedOverrides, setSimulatedOverrides] = useState<Record<string, number>>({});
  const [simulatedPrediction, setSimulatedPrediction] = useState<DashboardSummary["diabetesPrediction"] | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  useEffect(() => {
    if (summary) {
      const syncTypes = new Set(summary.latestMetrics.map(m => m.metricType));
      const appFeatures = new Set<string>();
      if (syncTypes.has("blood_glucose")) appFeatures.add("Glucose");
      if (syncTypes.has("blood_pressure_diastolic") || syncTypes.has("blood_pressure_systolic")) appFeatures.add("BloodPressure");
      if (syncTypes.has("weight") && syncTypes.has("height")) appFeatures.add("BMI");
      if (syncTypes.has("age")) appFeatures.add("Age");
      if (syncTypes.has("steps") || syncTypes.has("distance")) appFeatures.add("Daily_Steps");

      setEditableFeatures(["Glucose", "BloodPressure", "BMI", "Age", "Daily_Steps"].filter(f => !appFeatures.has(f)));
    }
  }, [summary]);

  useEffect(() => {
    if (Object.keys(simulatedOverrides).length === 0) {
      setSimulatedPrediction(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSimulating(true);
      try {
        const response = await fetch(`${API_BASE_URL}/api/v1/predict/simulate`, {
          method: "POST",
          headers: {
            "x-user-id": USER_ID,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(simulatedOverrides)
        });
        if (response.ok) {
          const data = await response.json();
          setSimulatedPrediction(data.prediction);
        }
      } catch (err) {
        console.error("Simulation failed", err);
      } finally {
        setIsSimulating(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [simulatedOverrides]);
  async function submitManualFeatures() {
    setIsLoading(true);
    try {
      const payload: Record<string, number | null> = {};
      for (const key of editableFeatures) {
        const val = manualInputs[key];
        if (val) {
          payload[key] = parseFloat(val);
        } else if (val === "") {
          payload[key] = null;
        }
      }
      const response = await fetch(`${API_BASE_URL}/api/v1/user/features`, {
        method: "POST",
        headers: {
          "x-user-id": USER_ID,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error("Failed to save manual features");
      setEditingFeatures(false);
      setShowModal(false);
      await loadDashboard();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to save manual features");
      setIsLoading(false);
    }
  }

  async function loadDashboard() {
    setIsLoading(true);
    try {
      const nextSummary = await getJson<DashboardSummary>("/api/v1/dashboard/summary");
      const preferredMetric = nextSummary.latestMetrics[0]?.metricType ?? "steps";
      const timelineWindow = getTimelineWindow(preferredMetric);
      setSummary(nextSummary);
      setSelectedMetric(preferredMetric);
      setTimeline(await getJson<TimelineResponse>(`/api/v1/dashboard/timeline?metricType=${preferredMetric}&days=${timelineWindow}`));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load dashboard");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    let active = true;

    async function loadTimeline() {
      try {
        const timelineWindow = getTimelineWindow(selectedMetric);
        const nextTimeline = await getJson<TimelineResponse>(`/api/v1/dashboard/timeline?metricType=${selectedMetric}&days=${timelineWindow}`);
        if (active) {
          setTimeline(nextTimeline);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load timeline");
        }
      }
    }

    if (selectedMetric) {
      loadTimeline();
    }

    return () => {
      active = false;
    };
  }, [selectedMetric]);

  const heroStats = useMemo(() => summary?.latestMetrics.slice(0, 4) ?? [], [summary]);
  const timelineValues = timeline?.data ?? [];
  const rawChartMin = timelineValues.length ? Math.min(...timelineValues.map((item) => item.value)) : 0;
  const rawChartMax = timelineValues.length ? Math.max(...timelineValues.map((item) => item.value)) : 1;
  const valuePadding = rawChartMax === rawChartMin
    ? Math.max(rawChartMax * 0.02, 0.5)
    : (rawChartMax - rawChartMin) * 0.04;
  const chartMin = usesZeroBaseline(selectedMetric) ? 0 : Math.max(0, rawChartMin - valuePadding);
  const minimumVisibleSpan = usesZeroBaseline(selectedMetric)
    ? 1
    : Math.max(rawChartMax * 0.04, 2);
  const chartMax = Math.max(chartMin + minimumVisibleSpan, rawChartMax + valuePadding);
  const chartRange = Math.max(chartMax - chartMin, 1);
  const chartTicks = Array.from({ length: 4 }, (_, index) => {
    const ratio = (3 - index) / 3;
    return chartMin + chartRange * ratio;
  });
  const prediction = summary?.diabetesPrediction ?? null;
  const maxImpact = Math.max(...(prediction?.shapExplanation.contributions.map((item) => Math.abs(item.impactPercent)) ?? [1]), 1);
  const observedFeatureSet = new Set(prediction?.featureSnapshot.observedFeatures ?? []);
  const requiredFeatures = ["Glucose", "BloodPressure", "BMI", "Age", "Daily_Steps"];
  const missingFeatures = requiredFeatures.filter(f => !observedFeatureSet.has(f));

  const harmfulFactors = prediction?.shapExplanation.contributions.filter(c => c.impactPercent > 0.0) ?? [];
  const getActionAdvice = (feature: string) => {
    switch(feature) {
      case "Glucose": return "High blood glucose is your primary risk driver. Consider adjusting carbohydrate intake and consulting your physician about glucose management.";
      case "BMI": return "Your current BMI is driving up your risk profile. Focus on a sustainable caloric deficit and regular exercise.";
      case "Daily_Steps": return "Your daily step count is below optimal levels. Increasing your average daily steps will actively drop your risk.";
      case "BloodPressure": return "Elevated blood pressure is contributing to your risk. Focus on cardiovascular health and sodium reduction.";
      default: return "";
    }
  };
  const actionPlanItems = harmfulFactors.map(f => ({ feature: f.feature, label: f.label, advice: getActionAdvice(f.feature) })).filter(f => f.advice !== "");

  return (
    <div className="page-shell">
      <div className="ambient-grid" />
      <header className="hero">
        <div>
          <div className="hero-brand">
            <h1 className="hero-logo-text">Dia-predict<span className="hero-logo-dot">.</span></h1>
          </div>
          <h1>Type 2 diabetes risk prediction from your watch data.</h1>
        </div>

        <div className="sync-card">
          <span className="status-dot" />
          <div>
            <p className="sync-label">Collector status</p>
            <p className="sync-value">
              {summary?.providerConnection?.status === "connected" ? "Android collector connected" : "Waiting for Android sync"}
            </p>
            <p className="sync-subvalue">
              {summary?.latestSync
                ? `Latest mobile sync ${formatDate(summary.latestSync.syncedAt)}${summary.latestSync.recordsInserted ? ` • ${summary.latestSync.recordsInserted} new records` : ""}`
                : "Open the Android app, grant Health Connect access, then tap Sync Now."}
            </p>
          </div>
        </div>
      </header>

      {error ? <section className="panel error-panel">{error}</section> : null}
      {isLoading ? <section className="panel">Loading dashboard...</section> : null}

      {!isLoading && summary && prediction ? (
        <>
          {missingFeatures.length > 0 && showModal && editableFeatures.length > 0 && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="panel" style={{ width: '90%', maxWidth: '400px', padding: '2rem', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)' }}>
                <h3 style={{ marginBottom: '0.5rem', color: '#0f766e', fontSize: '1.25rem' }}>Missing Information</h3>
                <p style={{ marginBottom: '1.5rem', color: '#58707a', lineHeight: '1.5' }}>
                  The prediction model needs values that aren't available from your synced apps. Please provide them for an accurate risk assessment:
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {editableFeatures.map(f => (
                    <div key={f} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0f766e' }}>{f}</label>
                      <input 
                        type="number" 
                        step="any" 
                        placeholder={getFeatureUnit(f)} 
                        value={manualInputs[f] ?? ""} 
                        onChange={e => setManualInputs({...manualInputs, [f]: e.target.value})}
                        style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '1rem', background: '#f8fafc' }}
                      />
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
                  <button 
                    style={{ flex: 1, padding: "0.75rem", borderRadius: "12px", background: "#f1f5f9", color: "#64748b", fontWeight: "bold", border: "none", cursor: "pointer" }}
                    onClick={() => setShowModal(false)}
                  >
                    Skip
                  </button>
                  <button 
                    disabled={isLoading}
                    style={{ flex: 2, padding: "0.75rem", borderRadius: "12px", background: "#0f766e", color: "#fff", fontWeight: "bold", border: "none", cursor: "pointer" }}
                    onClick={submitManualFeatures}
                  >
                    {isLoading ? "Saving..." : "Save & Calculate"}
                  </button>
                </div>
              </div>
            </div>
          )}
          <section className="panel prediction-panel">
            <div className="prediction-copy">
              <p className="section-kicker">Prediction</p>
            </div>

            <div className="prediction-scorecard">
              <div className="prediction-percent-row">
                <span className="prediction-percent">{prediction.riskPercent.toFixed(1)}%</span>
                <span className={`risk-chip risk-${prediction.riskLevel}`}>{formatRiskTone(prediction.riskLevel)} risk</span>
              </div>
              <div className="risk-bar-track" aria-label="Projected diabetes risk">
                <div className={`risk-bar-fill risk-${prediction.riskLevel}`} style={{ width: `${prediction.riskPercent.toFixed(1)}%` }} />
              </div>
              <p className="prediction-disclaimer">{prediction.disclaimer}</p>
            </div>
          </section>

          <section className="prediction-details-grid">
            <article className="panel feature-panel">
              <div className="panel-header">
                <div>
                  <p className="section-kicker">SHAP Graph</p>
                  <h3>Risk Contribution</h3>
                </div>
              </div>


              <div className="shap-chart">
                {prediction.shapExplanation.contributions.length ? prediction.shapExplanation.contributions.map((item) => {
                  const width = `${(Math.abs(item.impactPercent) / maxImpact) * 50}%`;
                  return (
                    <div className="shap-row" key={item.feature}>
                      <div className="shap-meta">
                        <p className="shap-label">{item.label}</p>
                        <p className="shap-value">
                          {item.observedFromWatch
                            ? formatContributionValue(item.feature, item.featureValue, true)
                            : "Not available"}
                        </p>
                      </div>
                      <div className="shap-bar-area">
                        <div className="shap-axis" />
                        <div
                          className={`shap-bar shap-${item.direction}`}
                          style={
                            item.direction === "increase"
                              ? { left: "50%", width }
                              : item.direction === "decrease"
                                ? { right: "50%", width }
                                : { left: "50%", width: "0%" }
                          }
                        />
                      </div>
                      <p className={`shap-impact shap-${item.direction}`}>{formatImpact(item.impactPercent)}</p>
                    </div>
                  );
                }) : (
                  <p className="shap-value">No explanation factors are available yet.</p>
                )}
              </div>
            </article>

            <article className="panel feature-panel">
              <div className="panel-header">
                <div>
                  <h3>Inputs</h3>
                </div>
              </div>

              <div className="feature-grid">
                <div className="feature-item"><span>Glucose</span><strong>{formatObservedFeatureValue("Glucose", prediction.featureSnapshot.glucose, observedFeatureSet.has("Glucose"))}</strong></div>
                <div className="feature-item"><span>Blood pressure</span><strong>{formatObservedFeatureValue("BloodPressure", prediction.featureSnapshot.bloodPressure, observedFeatureSet.has("BloodPressure"))}</strong></div>
                <div className="feature-item"><span>BMI</span><strong>{formatObservedFeatureValue("BMI", prediction.featureSnapshot.bmi, observedFeatureSet.has("BMI"))}</strong></div>
                <div className="feature-item"><span>Age</span><strong>{formatObservedFeatureValue("Age", prediction.featureSnapshot.age, observedFeatureSet.has("Age"))}</strong></div>
                <div className="feature-item"><span>Daily steps</span><strong>{formatObservedFeatureValue("Daily_Steps", prediction.featureSnapshot.dailySteps, observedFeatureSet.has("Daily_Steps"))}</strong></div>
                <div className="feature-item"><span>Observation window</span><strong>{prediction.featureSnapshot.observationDays.toFixed(1)} days</strong></div>
                <div className="feature-item feature-observed"><span>Observed from watch or sync input</span><strong>{prediction.featureSnapshot.observedFeatures.length ? prediction.featureSnapshot.observedFeatures.join(", ") : "No direct model inputs observed"}</strong></div>
              </div>

              <div className="driver-list compact-driver-list">
                {prediction.drivers.map((driver) => (
                  <div className="driver-pill" key={driver}>{driver}</div>
                ))}
              </div>
            </article>

            {editableFeatures.length > 0 && (
              <article className="panel feature-panel">
                <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p className="section-kicker">Manage Missing Inputs</p>
                    <h3>Enter missing data for best results</h3>
                  </div>
                  <button 
                    className="pill" 
                    style={{ background: editingFeatures ? "#cbd5e1" : "#0f766e", color: editingFeatures ? "#000" : "#fff", border: "none", cursor: "pointer", fontFamily: "inherit" }}
                    onClick={() => {
                      if (!editingFeatures) {
                        setManualInputs(Object.entries(summary?.manualFeatures ?? {}).reduce((acc, [k, v]) => ({ ...acc, [k]: v?.toString() ?? "" }), {}));
                      }
                      setEditingFeatures(!editingFeatures);
                    }}
                  >
                    {editingFeatures ? "Cancel" : "Edit"}
                  </button>
                </div>
                
                {editingFeatures ? (
                  <div style={{ marginTop: "1rem" }}>
                    <p className="provider-copy" style={{ marginBottom: "1rem" }}>Fill in metrics not collected by your watch. Clear a field to remove the override.</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '1rem' }}>
                      {editableFeatures.map(f => (
                        <div key={f} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#58707a' }}>{f}</label>
                          <input 
                            type="number" 
                            step="any" 
                            placeholder={getFeatureUnit(f)} 
                            value={manualInputs[f] ?? ""} 
                            onChange={e => setManualInputs({...manualInputs, [f]: e.target.value})}
                            style={{ padding: '0.5rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '1rem' }}
                          />
                        </div>
                      ))}
                    </div>
                    <button 
                      disabled={isLoading}
                      style={{ marginTop: "1.5rem", width: "100%", padding: "0.75rem", borderRadius: "12px", background: "#0f766e", color: "#fff", fontWeight: "bold", border: "none", cursor: "pointer" }}
                      onClick={submitManualFeatures}
                    >
                      {isLoading ? "Saving..." : "Save Features"}
                    </button>
                  </div>
                ) : (
                  <div style={{ marginTop: "1rem" }}>
                    {missingFeatures.length > 0 ? (
                      <p className="provider-copy" style={{ color: "#b45309", background: "#fef3c7", padding: "1rem", borderRadius: "12px", margin: 0 }}>
                        Missing observations for {missingFeatures.join(", ")}. Add them to strengthen the model.
                      </p>
                    ) : (
                      <p className="provider-copy" style={{ color: "#047857", background: "#d1fae5", padding: "1rem", borderRadius: "12px", margin: 0 }}>
                        All core model features are actively observed!
                      </p>
                    )}
                  </div>
                )}
              </article>
            )}
          </section>

          <section className="action-simulator-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px', marginBottom: '16px' }}>
            <article className="panel action-plan-panel">
              <div className="panel-header">
                <div>
                  <p className="section-kicker">Recommendations</p>
                  <h3>Action Plan</h3>
                </div>
              </div>
              <div className="action-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
                {actionPlanItems.length > 0 ? actionPlanItems.map(item => (
                  <div key={item.feature} className="action-item" style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', borderLeft: '4px solid #f43f5e' }}>
                    <h4 style={{ margin: '0 0 8px 0', color: '#0f172a' }}>{item.label}</h4>
                    <p style={{ margin: 0, fontSize: '0.9rem', color: '#475569', lineHeight: '1.4' }}>{item.advice}</p>
                  </div>
                )) : (
                  <div className="action-item" style={{ background: '#ecfdf5', padding: '16px', borderRadius: '12px', borderLeft: '4px solid #10b981' }}>
                    <h4 style={{ margin: '0 0 8px 0', color: '#065f46' }}>Optimal Profile</h4>
                    <p style={{ margin: 0, fontSize: '0.9rem', color: '#047857', lineHeight: '1.4' }}>No actionable modifiable risks found. Great job maintaining your health metrics!</p>
                  </div>
                )}
              </div>
            </article>

            <article className="panel simulator-panel">
              <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p className="section-kicker">Interactive</p>
                  <h3>What-If Simulator</h3>
                </div>
                {isSimulating && <span style={{ fontSize: '0.8rem', color: '#0f766e', fontWeight: 'bold' }}>Simulating...</span>}
              </div>
              
              <div className="simulator-results" style={{ marginTop: '16px', padding: '16px', background: '#0f172a', borderRadius: '12px', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <p style={{ margin: '0 0 4px', fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Simulated Risk</p>
                  <h2 style={{ margin: 0, fontSize: '2rem', color: simulatedPrediction ? '#38bdf8' : '#e2e8f0' }}>
                    {simulatedPrediction ? `${simulatedPrediction.riskPercent.toFixed(1)}%` : `${prediction.riskPercent.toFixed(1)}%`}
                  </h2>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: '0 0 4px', fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Delta</p>
                  <p style={{ margin: 0, fontSize: '1.25rem', fontWeight: 'bold', color: simulatedPrediction && simulatedPrediction.riskPercent < prediction.riskPercent ? '#10b981' : simulatedPrediction && simulatedPrediction.riskPercent > prediction.riskPercent ? '#f43f5e' : '#94a3b8' }}>
                    {simulatedPrediction ? (simulatedPrediction.riskPercent - prediction.riskPercent > 0 ? '+' : '') + (simulatedPrediction.riskPercent - prediction.riskPercent).toFixed(1) + '%' : '0.0%'}
                  </p>
                </div>
              </div>

              <div className="simulator-controls" style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {(["Glucose", "BMI", "Daily_Steps"] as const).map(feature => {
                  const currentValue = simulatedOverrides[feature] ?? prediction.featureSnapshot[feature === "Daily_Steps" ? "dailySteps" : (feature.toLowerCase() as "glucose" | "bmi")] as number;
                  const rangeConfig = feature === "Glucose" ? { min: 70, max: 200, step: 1 } : feature === "BMI" ? { min: 15, max: 40, step: 0.5 } : { min: 1000, max: 20000, step: 500 };
                  
                  return (
                    <div key={feature} className="simulator-slider-grp">
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <label style={{ fontSize: '0.9rem', fontWeight: 600, color: '#334155' }}>
                          {feature.replace("_", " ")}
                        </label>
                        <span style={{ fontSize: '0.9rem', color: '#0f766e', fontWeight: 'bold' }}>{currentValue.toFixed(feature === "BMI" ? 1 : 0)} {getFeatureUnit(feature)}</span>
                      </div>
                      <input 
                        type="range" 
                        min={rangeConfig.min} max={rangeConfig.max} step={rangeConfig.step}
                        value={currentValue}
                        onChange={(e) => setSimulatedOverrides({...simulatedOverrides, [feature]: parseFloat(e.target.value)})}
                        style={{ width: '100%', accentColor: '#0f766e' }}
                      />
                    </div>
                  );
                })}
                {Object.keys(simulatedOverrides).length > 0 && (
                  <button 
                    onClick={() => setSimulatedOverrides({})}
                    style={{ marginTop: '8px', padding: '8px', background: 'transparent', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#475569', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Reset Simulator
                  </button>
                )}
              </div>
            </article>
          </section>

          <section className="metric-grid">
            {heroStats.map((metric) => (
              <article className="metric-card" key={metric.metricType}>
                <p>{formatMetricLabel(metric.metricType)}</p>
                <h2>{metric.value.toFixed(1)}</h2>
                <div className="metric-meta">
                  <span>{metric.unit}</span>
                  <span>{metric.sourceDevice}</span>
                </div>
              </article>
            ))}
          </section>

          <section className="content-grid">
            <article className="panel chart-panel">
              <div className="panel-header">
                <div>
                  <p className="section-kicker">Trend</p>
                  <h3>{formatMetricLabel(selectedMetric)}</h3>
                </div>
                <select className="metric-select" value={selectedMetric} onChange={(event) => setSelectedMetric(event.target.value)}>
                  {summary.latestMetrics.map((metric) => (
                    <option key={metric.metricType} value={metric.metricType}>
                      {formatMetricLabel(metric.metricType)}
                    </option>
                  ))}
                </select>
              </div>

              {timelineValues.length ? (
                <div className="trend-chart">
                  <div className="trend-axis">
                    {chartTicks.map((tick, index) => (
                      <div className="trend-axis-tick" key={`${selectedMetric}-tick-${index}`}>
                        <span>{formatChartNumber(tick)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="sparkline">
                    {timelineValues.map((item) => (
                      <div className="sparkline-bar-wrap" key={item.id}>
                        <span className="sparkline-value">{formatChartNumber(item.value)}</span>
                        <div
                          className="sparkline-bar"
                          style={{ height: `${Math.max(((item.value - chartMin) / chartRange) * 100, 8)}%` }}
                          title={`${item.value} ${item.unit} on ${formatDate(item.endTime)}`}
                        />
                        <span>{formatDayLabel(item.date ?? item.endTime)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="records-empty">No {formatMetricLabel(selectedMetric).toLowerCase()} records are available in the selected time window.</p>
              )}
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="section-kicker">Daily Summary</p>
                  <h3>Recent imported metrics</h3>
                </div>
              </div>

              <div className="summary-list">
                {summary.dailySummary.map((day) => (
                  <div className="summary-row" key={day.date}>
                    <div>
                      <p className="summary-date">{day.date}</p>
                      <p className="summary-count">{Object.keys(day.metrics).length} tracked metrics</p>
                    </div>
                    <div className="summary-pills">
                      {Object.entries(day.metrics).slice(0, 3).map(([metricType, value]) => (
                        <span className="pill" key={metricType}>
                          {formatMetricLabel(metricType)} {value.latest.toFixed(1)} {value.unit}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          </section>

        </>
      ) : null}
    </div>
  );
}
