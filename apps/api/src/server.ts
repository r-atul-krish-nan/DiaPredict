import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import cors from "cors";
import express, { type Request } from "express";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";
const seedDemo = process.env.SEED_DEMO_DATA === "true";
const projectRoot = resolve(process.cwd(), "..", "..");
const storageDirectory = resolve(process.cwd(), "data");
const storageFile = resolve(storageDirectory, "store.json");
const trainedModelPath = resolve(projectRoot, "models", "diabetes-random-forest.json");
const trainingReportPath = resolve(projectRoot, "models", "training-report.json");
const shapScriptPath = resolve(projectRoot, "scripts", "explain_with_shap.py");
const venvPythonPath = resolve(projectRoot, ".venv", "Scripts", "python.exe");

type SyncRecordInput = {
  sourceRecordId: string;
  metricType: string;
  startTime: string;
  endTime: string;
  value: number;
  unit: string;
  sourceApp: string;
  sourceDevice: string;
  metadata?: Record<string, unknown>;
};

type StoredRecord = SyncRecordInput & {
  id: string;
  userId: string;
  receivedAt: string;
};

type SyncState = {
  userId: string;
  provider: "health_connect";
  syncToken: string;
  syncedAt: string;
  mode: "api";
  recordsInserted: number;
};

type ConnectionState = {
  userId: string;
  provider: "health_connect";
  status: "connected" | "disconnected";
  connectedAt: string | null;
  externalUserId: string | null;
  scopes: string[];
};

type PersistedState = {
  recordsByUser: Array<[string, StoredRecord[]]>;
  syncStateByUser: Array<[string, SyncState]>;
  connectionByUser: Array<[string, ConnectionState]>;
  manualFeaturesByUser: Array<[string, Partial<ModelFeatures>]>;
  dedupeKeys: string[];
};

type TrainedTree = {
  childrenLeft: number[];
  childrenRight: number[];
  features: number[];
  thresholds: number[];
  values: number[][];
};

type TrainedRandomForestModel = {
  modelType: "random_forest_classifier";
  trainedAt: string;
  dataset: string;
  featureNames: Array<"Glucose" | "BloodPressure" | "BMI" | "Age" | "Daily_Steps">;
  targetName: string;
  defaultFeatureValues: Record<string, number>;
  nEstimators: number;
  featureImportances: Record<string, number>;
  trees: TrainedTree[];
};

type TrainingReport = {
  accuracy: number;
  rocAuc: number;
  trainRows: number;
  testRows: number;
  features: string[];
  defaultFeatureValues: Record<string, number>;
  featureImportances: Record<string, number>;
};

type ModelFeatures = {
  Glucose: number;
  BloodPressure: number;
  BMI: number;
  Age: number;
  Daily_Steps: number;
};

type DerivedModelFeatures = {
  values: ModelFeatures;
  observedFeatures: string[];
  observationDays: number;
};

type ShapContribution = {
  feature: string;
  label: string;
  featureValue: number;
  shapValue: number;
  direction: "increase" | "decrease" | "neutral";
  observedFromWatch: boolean;
};

type ShapExplanation = {
  probability: number;
  baseValue: number;
  contributions: ShapContribution[];
};

type DiabetesPrediction = {
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

const recordsByUser = new Map<string, StoredRecord[]>();
const syncStateByUser = new Map<string, SyncState>();
const connectionByUser = new Map<string, ConnectionState>();
const manualFeaturesByUser = new Map<string, Partial<ModelFeatures>>();
const dedupeKeys = new Set<string>();
const trainedModel = loadTrainedModel();
const trainingReport = loadTrainingReport();

loadState();
if (!seedDemo) {
  purgeSeedOnlyState();
}
if (seedDemo && !hasPersistedRecords()) {
  seedDemoData();
}

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "diapredict-api",
    timestamp: new Date().toISOString()
  });
});

app.post("/api/v1/sync/batch", (request, response) => {
  const userId = getUserId(request);
  const payload = request.body as { cursor?: unknown; records?: unknown };

  if (typeof payload?.cursor !== "string" || !Array.isArray(payload.records)) {
    response.status(400).type("text/plain").send("Invalid sync payload.");
    return;
  }

  const validRecords = payload.records.filter(isValidSyncRecord);
  if (validRecords.length !== payload.records.length) {
    response.status(400).type("text/plain").send("Invalid sync payload.");
    return;
  }

  ensureConnected(userId);
  const insertedCount = storeRecords(userId, payload.cursor, validRecords);

  response.type("text/plain").send(
    `Stored ${insertedCount} of ${validRecords.length} Health Connect records.`
  );
});

app.get("/api/v1/dashboard/summary", (request, response) => {
  const userId = getUserId(request);
  const userRecords = recordsByUser.get(userId) ?? [];
  const latestByMetric = new Map<string, StoredRecord>();

  for (const record of userRecords) {
    latestByMetric.set(record.metricType, record);
  }

  response.json({
    providerConnection: connectionByUser.get(userId) ?? null,
    latestSync: syncStateByUser.get(userId) ?? null,
    manualFeatures: manualFeaturesByUser.get(userId) ?? null,
    diabetesPrediction: buildDiabetesPrediction(userRecords, userId),
    latestMetrics: Array.from(latestByMetric.values())
      .sort((left, right) => right.endTime.localeCompare(left.endTime))
      .map((record) => ({
        metricType: record.metricType,
        value: record.value,
        unit: record.unit,
        measuredAt: record.endTime,
        sourceDevice: record.sourceDevice,
        sourceApp: record.sourceApp
      })),
    recentRecords: [...userRecords]
      .sort((left, right) => right.endTime.localeCompare(left.endTime))
      .slice(0, 18)
      .map((record) => ({
        id: record.id,
        metricType: record.metricType,
        value: record.value,
        unit: record.unit,
        measuredAt: record.endTime,
        receivedAt: record.receivedAt,
        sourceDevice: record.sourceDevice,
        sourceApp: record.sourceApp
      })),
    dailySummary: buildDailySummary(userId).slice(0, 7)
  });
});

app.post("/api/v1/user/features", (request, response) => {
  const userId = getUserId(request);
  const body = request.body as Partial<ModelFeatures>;
  
  const current = manualFeaturesByUser.get(userId) ?? {};
  const updated = { ...current };
  
  if (typeof body.Glucose === "number" || body.Glucose === null) updated.Glucose = body.Glucose ?? undefined;
  if (typeof body.BloodPressure === "number" || body.BloodPressure === null) updated.BloodPressure = body.BloodPressure ?? undefined;
  if (typeof body.BMI === "number" || body.BMI === null) updated.BMI = body.BMI ?? undefined;
  if (typeof body.Age === "number" || body.Age === null) updated.Age = body.Age ?? undefined;
  if (typeof body.Daily_Steps === "number" || body.Daily_Steps === null) updated.Daily_Steps = body.Daily_Steps ?? undefined;
  
  manualFeaturesByUser.set(userId, updated);
  saveState();
  
  response.json({ success: true, features: updated });
});

app.post("/api/v1/predict/simulate", (request, response) => {
  const userId = getUserId(request);
  const overrides = request.body as Partial<ModelFeatures>;
  const userRecords = recordsByUser.get(userId) ?? [];
  
  const simulatedPrediction = buildDiabetesPrediction(userRecords, userId, overrides);
  response.json({ prediction: simulatedPrediction });
});

app.get("/api/v1/dashboard/timeline", (request, response) => {
  const userId = getUserId(request);
  const metricType = typeof request.query.metricType === "string" ? request.query.metricType : "steps";
  const daysRaw = typeof request.query.days === "string" ? Number(request.query.days) : 7;
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 90) : 7;
  const threshold = new Date();
  threshold.setUTCDate(threshold.getUTCDate() - days);

  response.json({
    metricType,
    days,
    data: buildTimelineSeries(userId, metricType, threshold)
  });
});

app.listen(port, () => {
  console.log(`DiaPredict API listening on http://localhost:${port}`);
});

function getUserId(request: Request) {
  return request.header("x-user-id") ?? "demo-user";
}

function ensureConnected(userId: string) {
  if (!connectionByUser.has(userId)) {
    connectionByUser.set(userId, {
      userId,
      provider: "health_connect",
      status: "connected",
      connectedAt: new Date().toISOString(),
      externalUserId: userId,
      scopes: ["health_connect.read"]
    });
    saveState();
  }
}

function storeRecords(userId: string, cursor: string, incomingRecords: SyncRecordInput[]) {
  const existing = recordsByUser.get(userId) ?? [];
  const hasRealIncomingRecords = incomingRecords.some((record) => !isSeedRecord(record));

  if (hasRealIncomingRecords && existing.length > 0 && existing.every(isSeedRecord)) {
    clearUserRecords(userId, existing);
  }

  const nextRecords = recordsByUser.get(userId) ?? [];
  let insertedCount = 0;

  for (const record of incomingRecords) {
    const dedupeKey = `${userId}:health_connect:${record.metricType}:${record.sourceRecordId}`;
    if (dedupeKeys.has(dedupeKey)) {
      continue;
    }

    dedupeKeys.add(dedupeKey);
    nextRecords.push({
      ...record,
      id: randomUUID(),
      userId,
      receivedAt: new Date().toISOString(),
      metadata: record.metadata ?? {}
    });
    insertedCount += 1;
  }

  nextRecords.sort((left, right) => left.startTime.localeCompare(right.startTime));
  recordsByUser.set(userId, nextRecords);
  syncStateByUser.set(userId, {
    userId,
    provider: "health_connect",
    syncToken: cursor,
    syncedAt: new Date().toISOString(),
    mode: "api",
    recordsInserted: insertedCount
  });
  saveState();

  return insertedCount;
}

function clearUserRecords(userId: string, records: StoredRecord[]) {
  for (const record of records) {
    dedupeKeys.delete(`${userId}:health_connect:${record.metricType}:${record.sourceRecordId}`);
  }

  recordsByUser.set(userId, []);
}

function buildDailySummary(userId: string) {
  const byDay = new Map<string, Map<string, StoredRecord[]>>();

  for (const record of recordsByUser.get(userId) ?? []) {
    const date = record.startTime.slice(0, 10);
    const metrics = byDay.get(date) ?? new Map<string, StoredRecord[]>();
    const bucket = metrics.get(record.metricType) ?? [];
    bucket.push(record);
    metrics.set(record.metricType, bucket);
    byDay.set(date, metrics);
  }

  return Array.from(byDay.entries())
    .sort((left, right) => right[0].localeCompare(left[0]))
    .map(([date, metrics]) => {
      const normalizedMetrics: Record<string, { min: number; max: number; avg: number; latest: number; unit: string; count: number }> = {};

      for (const [metricType, bucket] of metrics.entries()) {
        const values = bucket.map((item) => item.value);
        const latest = bucket.sort((left, right) => right.endTime.localeCompare(left.endTime))[0];
        const avg = values.reduce((sum, value) => sum + value, 0) / values.length;

        normalizedMetrics[metricType] = {
          min: Math.min(...values),
          max: Math.max(...values),
          avg: Number(avg.toFixed(1)),
          latest: latest.value,
          unit: latest.unit,
          count: values.length
        };
      }

      return { userId, date, metrics: normalizedMetrics };
    });
}

function buildTimelineSeries(userId: string, metricType: string, threshold: Date) {
  const relevantRecords = (recordsByUser.get(userId) ?? []).filter((record) => {
    const timestamp = parseRecordTimestamp(record.endTime);
    return record.metricType === metricType && timestamp !== null && timestamp >= threshold.getTime();
  });

  const byDay = new Map<string, StoredRecord[]>();
  for (const record of relevantRecords) {
    const date = record.endTime.slice(0, 10);
    const bucket = byDay.get(date) ?? [];
    bucket.push(record);
    byDay.set(date, bucket);
  }

  return Array.from(byDay.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([date, bucket]) => {
      const latest = [...bucket].sort((left, right) => right.endTime.localeCompare(left.endTime))[0];
      const aggregateValue = aggregateTimelineMetric(metricType, bucket);

      return {
        id: `${metricType}-${date}`,
        metricType,
        date,
        endTime: latest.endTime,
        value: roundTo(aggregateValue, 1),
        unit: latest.unit,
        sourceDevice: latest.sourceDevice
      };
    });
}

function aggregateTimelineMetric(metricType: string, bucket: StoredRecord[]) {
  const values = bucket.map((record) => record.value);

  if (["steps", "distance", "active_calories_burned", "total_calories_burned", "nutrition_energy", "hydration"].includes(metricType)) {
    return values.reduce((sum, value) => sum + value, 0);
  }

  if (["weight", "height", "body_fat"].includes(metricType)) {
    return [...bucket].sort((left, right) => right.endTime.localeCompare(left.endTime))[0].value;
  }

  return average(values);
}

function buildDiabetesPrediction(records: StoredRecord[], userId: string, overrides?: Partial<ModelFeatures>): DiabetesPrediction {
  const derived = extractModelFeatures(records, userId, overrides);
  const shapExplanation = getShapExplanation(derived.values, derived.observedFeatures);
    // Heuristics
  const sleepRecords = records.filter(r => r.metricType === "sleep");
  const hrRecords = records.filter(r => r.metricType === "heart_rate" || r.metricType === "resting_heart_rate");
  const o2Records = records.filter(r => r.metricType === "oxygen_saturation");
  const activeCalRecords = records.filter(r => r.metricType === "active_calories_burned" || r.metricType === "exercise");
  const hydrationRecords = records.filter((record) => record.metricType === "hydration");

  let heuristicAdjustment = 0;
  const heuristicContributions: ShapContribution[] = [];

  const avgSleep = sleepRecords.length ? average(sleepRecords.map(r => r.value)) : null;
  if (avgSleep !== null) {
      const sleepImpact = avgSleep < 6 ? 0.05 : (avgSleep > 7.5 ? -0.02 : 0);
      if (sleepImpact !== 0) {
          heuristicAdjustment += sleepImpact;
          heuristicContributions.push({
              feature: "Sleep",
              label: "Average Sleep",
              featureValue: roundTo(avgSleep, 1),
              shapValue: sleepImpact,
              direction: sleepImpact > 0 ? "increase" : "decrease",
              observedFromWatch: true
          });
      }
  }

  const avgHr = hrRecords.length ? average(hrRecords.map(r => r.value)) : null;
  if (avgHr !== null) {
      const hrImpact = avgHr > 80 ? 0.04 : (avgHr < 65 ? -0.03 : 0);
      if (hrImpact !== 0) {
          heuristicAdjustment += hrImpact;
          heuristicContributions.push({
              feature: "Heart_Rate",
              label: "Avg Heart Rate",
              featureValue: Math.round(avgHr),
              shapValue: hrImpact,
              direction: hrImpact > 0 ? "increase" : "decrease",
              observedFromWatch: true
          });
      }
  }

  const avgO2 = o2Records.length ? average(o2Records.map(r => r.value)) : null;
  if (avgO2 !== null) {
      const o2Impact = avgO2 < 95 ? 0.03 : 0;
      if (o2Impact !== 0) {
          heuristicAdjustment += o2Impact;
          heuristicContributions.push({
              feature: "Oxygen",
              label: "Blood Oxygen",
              featureValue: Math.round(avgO2),
              shapValue: o2Impact,
              direction: o2Impact > 0 ? "increase" : "decrease",
              observedFromWatch: true
          });
      }
  }
  
  const hasActiveFitness = activeCalRecords.length > 0;
  if (hasActiveFitness) {
      heuristicAdjustment -= 0.04;
      heuristicContributions.push({
          feature: "Fitness",
          label: "Active Fitness",
          featureValue: activeCalRecords.length,
          shapValue: -0.04,
          direction: "decrease",
          observedFromWatch: true
      });
  }

  const averageDailyHydration = averageDailyMetric(hydrationRecords);
  if (averageDailyHydration !== null) {
      const hydrationImpact = averageDailyHydration < 1.5 ? 0.025 : (averageDailyHydration >= 2.3 ? -0.015 : 0);
      if (hydrationImpact !== 0) {
          heuristicAdjustment += hydrationImpact;
          heuristicContributions.push({
              feature: "Hydration",
              label: "Water Intake",
              featureValue: roundTo(averageDailyHydration, 2),
              shapValue: hydrationImpact,
              direction: hydrationImpact > 0 ? "increase" : "decrease",
              observedFromWatch: true
          });
      }
  }

  let probability = shapExplanation.probability + heuristicAdjustment;
  probability = Math.max(0, Math.min(1, probability));
  shapExplanation.contributions.push(...heuristicContributions);
  shapExplanation.contributions.sort((a, b) => Math.abs(b.shapValue) - Math.abs(a.shapValue));
  const displayContributions = shapExplanation.contributions
    .map((contribution) => contribution.observedFromWatch
      ? contribution
      : {
          ...contribution,
          shapValue: 0,
          direction: "neutral" as const
        })
    .sort((left, right) => {
      const isCoreLeft = trainedModel.featureNames.includes(left.feature as any);
      const isCoreRight = trainedModel.featureNames.includes(right.feature as any);
      if (isCoreLeft !== isCoreRight) {
        return isCoreLeft ? -1 : 1;
      }
      return Math.abs(right.shapValue) - Math.abs(left.shapValue);
    });
  const riskPercent = roundTo(probability * 100, 1);
  const confidencePercent = roundTo(Math.min(0.45 + (derived.observedFeatures.length / trainedModel.featureNames.length) * 0.45 + Math.min(derived.observationDays / 30, 1) * 0.1, 0.95) * 100, 1);
  const riskLevel = probability >= 0.65 ? "higher" : probability >= 0.4 ? "moderate" : "lower";
  const label = riskLevel === "higher"
    ? "Higher projected type 2 diabetes risk"
    : riskLevel === "moderate"
      ? "Moderate projected type 2 diabetes risk"
      : "Lower projected type 2 diabetes risk";

  return {
    label,
    riskPercent,
    riskLevel,
    confidencePercent,
    basedOn: `${derived.observationDays} day watch-data window`,
    featureSnapshot: {
      glucose: roundTo(derived.values.Glucose, 1),
      bloodPressure: roundTo(derived.values.BloodPressure, 1),
      bmi: roundTo(derived.values.BMI, 1),
      age: roundTo(derived.values.Age, 1),
      dailySteps: roundTo(derived.values.Daily_Steps, 1),
      observationDays: derived.observationDays,
      observedFeatures: derived.observedFeatures
    },
    shapExplanation: {
      basePercent: roundTo(shapExplanation.baseValue * 100, 1),
      contributions: displayContributions.map((contribution) => ({
        feature: contribution.feature,
        label: contribution.label,
        featureValue: roundTo(contribution.featureValue, 1),
        impactPercent: roundTo(contribution.shapValue * 100, 1),
        direction: Math.abs(contribution.shapValue) < 0.001 ? "neutral" : contribution.direction,
        observedFromWatch: contribution.observedFromWatch
      }))
    },
    drivers: buildDriverNotes(displayContributions),
    disclaimer: "",
    modelDetails: {
      dataset: "diabetes_cleaned.csv",
      trainedAt: trainedModel.trainedAt,
      rocAuc: roundTo(trainingReport.rocAuc, 1),
      accuracy: roundTo(trainingReport.accuracy, 1)
    }
  };
}

function extractModelFeatures(records: StoredRecord[], userId: string, overrides?: Partial<ModelFeatures>): DerivedModelFeatures {
  const baseManualFeatures = manualFeaturesByUser.get(userId) ?? {};
  const manualFeatures = { ...baseManualFeatures, ...overrides };
  const now = Date.now();
  const lookbackMs = 30 * 24 * 60 * 60 * 1000;
  const recentRecords = records.filter((record) => {
    const timestamp = parseRecordTimestamp(record.endTime);
    return timestamp !== null && now - timestamp <= lookbackMs;
  });
  const relevantRecords = recentRecords.length ? recentRecords : records;
  const uniqueDays = new Set(relevantRecords.map((record) => record.startTime.slice(0, 10)));
  const observationDays = Math.max(uniqueDays.size, 1);

  const getMetricRecords = (metricType: string) => relevantRecords.filter((record) => record.metricType === metricType);
  const latestMetric = (metricType: string) => getMetricRecords(metricType).sort((left, right) => right.endTime.localeCompare(left.endTime))[0] ?? null;

  const latestGlucose = latestMetric("blood_glucose")?.value ?? null;
  const latestDiastolic = latestMetric("blood_pressure_diastolic")?.value ?? null;
  const latestWeight = latestMetric("weight")?.value ?? null;
  const latestHeight = latestMetric("height")?.value ?? null;
  const latestBodyFat = latestMetric("body_fat")?.value ?? null;
  const latestAge = latestMetric("age")?.value ?? null;
  const stepRecords = getMetricRecords("steps");
  const distanceRecords = getMetricRecords("distance");

  const averageDailySteps = stepRecords.length
    ? averageDailyMetric(stepRecords)
    : estimateStepsFromDistance(distanceRecords);

  const bmi = latestWeight !== null && latestHeight !== null && latestHeight > 0
    ? latestWeight / (latestHeight * latestHeight)
    : null;

  const resolvedGlucose = manualFeatures.Glucose ?? latestGlucose ?? trainedModel.defaultFeatureValues.Glucose;
  const resolvedBloodPressure = manualFeatures.BloodPressure ?? latestDiastolic ?? trainedModel.defaultFeatureValues.BloodPressure;
  const resolvedBMI = manualFeatures.BMI ?? bmi ?? trainedModel.defaultFeatureValues.BMI;
  const resolvedAge = manualFeatures.Age ?? latestAge ?? trainedModel.defaultFeatureValues.Age;
  const resolvedDailySteps = manualFeatures.Daily_Steps ?? averageDailySteps ?? trainedModel.defaultFeatureValues.Daily_Steps;

  const observedFeatures = [
    (manualFeatures.Glucose !== undefined || latestGlucose !== null) ? "Glucose" : null,
    (manualFeatures.BloodPressure !== undefined || latestDiastolic !== null) ? "BloodPressure" : null,
    (manualFeatures.BMI !== undefined || bmi !== null) ? "BMI" : null,
    (manualFeatures.Age !== undefined || latestAge !== null) ? "Age" : null,
    (manualFeatures.Daily_Steps !== undefined || averageDailySteps !== null) ? "Daily_Steps" : null
  ].filter((value): value is string => Boolean(value));

  return {
    values: {
      Glucose: resolvedGlucose,
      BloodPressure: resolvedBloodPressure,
      BMI: resolvedBMI,
      Age: resolvedAge,
      Daily_Steps: resolvedDailySteps
    },
    observedFeatures,
    observationDays
  };
}

function averageDailyMetric(records: StoredRecord[]) {
  if (!records.length) {
    return null;
  }

  const totalsByDay = new Map<string, number>();
  for (const record of records) {
    const day = record.endTime.slice(0, 10);
    totalsByDay.set(day, (totalsByDay.get(day) ?? 0) + record.value);
  }

  return average(Array.from(totalsByDay.values()));
}

function parseRecordTimestamp(value: string) {
  const normalized = value.replace(/\.([0-9]{3})[0-9]+Z$/, ".$1Z");
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function estimateStepsFromDistance(distanceRecords: StoredRecord[]) {
  if (!distanceRecords.length) {
    return null;
  }

  const metersPerDay = new Map<string, number>();
  for (const record of distanceRecords) {
    const day = record.startTime.slice(0, 10);
    metersPerDay.set(day, (metersPerDay.get(day) ?? 0) + record.value);
  }

  const averageMeters = average(Array.from(metersPerDay.values()));
  const estimatedStepLengthMeters = 0.78;
  return averageMeters / estimatedStepLengthMeters;
}

function getShapExplanation(featureValues: ModelFeatures, observedFeatures: string[]): ShapExplanation {
  const fallbackProbability = predictRandomForestProbability(featureValues);
  const payload = JSON.stringify({ values: featureValues, observedFeatures });

  try {
    const result = spawnSync(venvPythonPath, [shapScriptPath], {
      cwd: projectRoot,
      input: payload,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 10
    });

    if (result.error || result.status !== 0 || !result.stdout.trim()) {
      throw new Error(result.error?.message ?? result.stderr ?? "SHAP explanation failed");
    }

    return JSON.parse(result.stdout) as ShapExplanation;
  } catch {
    return {
      probability: fallbackProbability,
      baseValue: 0.5,
      contributions: trainedModel.featureNames.map((feature) => ({
        feature,
        label: feature.replaceAll("_", " "),
        featureValue: featureValues[feature],
        shapValue: 0,
        direction: "neutral",
        observedFromWatch: observedFeatures.includes(feature)
      }))
    };
  }
}

function predictRandomForestProbability(featureValues: ModelFeatures) {
  const vector = trainedModel.featureNames.map((name) => featureValues[name]);
  const probabilities = trainedModel.trees.map((tree) => predictTreeProbability(tree, vector));
  return average(probabilities);
}

function predictTreeProbability(tree: TrainedTree, vector: number[]) {
  let nodeIndex = 0;

  while (tree.childrenLeft[nodeIndex] !== -1 && tree.childrenRight[nodeIndex] !== -1) {
    const featureIndex = tree.features[nodeIndex];
    const threshold = tree.thresholds[nodeIndex];
    nodeIndex = vector[featureIndex] <= threshold ? tree.childrenLeft[nodeIndex] : tree.childrenRight[nodeIndex];
  }

  return tree.values[nodeIndex][1] ?? 0;
}

function buildDriverNotes(contributions: ShapContribution[]) {
  const mapped = contributions
    .filter((item) => Math.abs(item.shapValue) > 0.001)
    .slice(0, 3)
    .map((item) => {
      const directionText = item.shapValue >= 0 ? "raised" : "lowered";
      return `${item.label} ${directionText} the risk score by ${Math.abs(roundTo(item.shapValue * 100, 1))} points`;
    });

  return mapped.length ? mapped : ["No strong SHAP contribution stood out for the current feature values."];
}

function loadTrainedModel(): TrainedRandomForestModel {
  if (!existsSync(trainedModelPath)) {
    throw new Error(`Trained model not found at ${trainedModelPath}`);
  }

  return JSON.parse(readFileSync(trainedModelPath, "utf8")) as TrainedRandomForestModel;
}

function loadTrainingReport(): TrainingReport {
  if (!existsSync(trainingReportPath)) {
    throw new Error(`Training report not found at ${trainingReportPath}`);
  }

  return JSON.parse(readFileSync(trainingReportPath, "utf8")) as TrainingReport;
}

function roundTo(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function seedDemoData() {
  const userId = "demo-user";
  ensureConnected(userId);

  const sampleMetrics: Array<{ metricType: string; unit: string; values: number[] }> = [
    { metricType: "steps", unit: "count", values: [5120, 6840, 7012, 8450, 7922, 9320, 10110] },
    { metricType: "heart_rate", unit: "bpm", values: [68, 67, 72, 70, 66, 69, 71] },
    { metricType: "sleep", unit: "hours", values: [7.1, 6.8, 7.4, 7.0, 6.6, 7.5, 7.2] },
    { metricType: "weight", unit: "kg", values: [81.8, 81.6, 81.5, 81.3, 81.2, 81.1, 81.0] },
    { metricType: "oxygen_saturation", unit: "%", values: [98, 98, 97, 99, 98, 97, 98] }
  ];

  const records = sampleMetrics.flatMap(({ metricType, unit, values }) => values.map((value, index) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - (values.length - 1 - index));

    const startTime = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 6, 0, 0)).toISOString();
    const endTime = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 6, 15, 0)).toISOString();

    return {
      sourceRecordId: `${metricType}-${index + 1}`,
      metricType,
      startTime,
      endTime,
      value,
      unit,
      sourceApp: "com.sec.android.app.shealth",
      sourceDevice: "Samsung Health demo device",
      metadata: { source: "seed" }
    } satisfies SyncRecordInput;
  }));

  storeRecords(userId, "demo-health-connect-cursor", records);
}

function isSeedRecord(record: Pick<SyncRecordInput, "metadata">) {
  return record.metadata?.source === "seed";
}

function hasPersistedRecords() {
  return Array.from(recordsByUser.values()).some((records) => records.length > 0);
}

function purgeSeedOnlyState() {
  const allRecords = Array.from(recordsByUser.values()).flat();
  if (allRecords.length === 0 || allRecords.some((record) => !isSeedRecord(record))) {
    return;
  }

  recordsByUser.clear();
  syncStateByUser.clear();
  connectionByUser.clear();
  manualFeaturesByUser.clear();
  dedupeKeys.clear();
  saveState();
}

function loadState() {
  if (!existsSync(storageFile)) {
    return;
  }

  try {
    const parsed = JSON.parse(readFileSync(storageFile, "utf8")) as PersistedState;

    for (const [userId, records] of parsed.recordsByUser ?? []) {
      recordsByUser.set(userId, records);
    }

    for (const [userId, syncState] of parsed.syncStateByUser ?? []) {
      syncStateByUser.set(userId, syncState);
    }

    for (const [userId, connectionState] of parsed.connectionByUser ?? []) {
      connectionByUser.set(userId, connectionState);
    }

    for (const [userId, features] of parsed.manualFeaturesByUser ?? []) {
      manualFeaturesByUser.set(userId, features);
    }

    for (const key of parsed.dedupeKeys ?? []) {
      dedupeKeys.add(key);
    }
  } catch (error) {
    console.error("Failed to load persisted DiaPredict state.", error);
  }
}

function saveState() {
  try {
    mkdirSync(storageDirectory, { recursive: true });
    const state: PersistedState = {
      recordsByUser: Array.from(recordsByUser.entries()),
      syncStateByUser: Array.from(syncStateByUser.entries()),
      connectionByUser: Array.from(connectionByUser.entries()),
      manualFeaturesByUser: Array.from(manualFeaturesByUser.entries()),
      dedupeKeys: Array.from(dedupeKeys.values())
    };

    writeFileSync(storageFile, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error("Failed to persist DiaPredict state.", error);
  }
}

function isValidSyncRecord(value: unknown): value is SyncRecordInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.sourceRecordId === "string" &&
    typeof record.metricType === "string" &&
    typeof record.startTime === "string" &&
    typeof record.endTime === "string" &&
    typeof record.value === "number" &&
    typeof record.unit === "string" &&
    typeof record.sourceApp === "string" &&
    typeof record.sourceDevice === "string"
  );
}
