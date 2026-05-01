# DiaPredict 2.0

DiaPredict is a wearable-assisted **Type 2 diabetes risk prediction system** that combines:

- an **Android sync app** that reads permitted health data from **Health Connect**
- a **Node.js + Express + TypeScript API** that stores data and runs prediction logic
- a **React dashboard** that shows risk, trends, and explainability
- a **Random Forest classifier** with **SHAP-based explainability**

The current project uses Samsung Health data **through Health Connect**. The Android app does not read Samsung Health directly; it reads the data that Samsung Health shares into Health Connect after the user grants permission.

## What the project does

DiaPredict is designed as a preventive health tool, not a diagnostic tool. It uses wearable and manually entered health signals to estimate a user's future risk of Type 2 diabetes and explain the main factors that influenced that estimate.

The system currently:

- reads Health Connect data on Android
- uploads synced records to the backend
- stores and aggregates metric history
- converts health records into model features
- predicts diabetes risk using a trained Random Forest model
- explains the prediction using SHAP
- displays the result in a web dashboard

## System flow

```text
Samsung Health -> Health Connect -> Android Sync App -> API -> Web Dashboard
```

More specifically:

1. A smartwatch or health app records health metrics.
2. Samsung Health shares supported records with Health Connect.
3. The DiaPredict Android app reads permitted Health Connect records.
4. The app sends the records to the DiaPredict backend.
5. The backend stores the records and extracts model features.
6. The Random Forest model predicts diabetes risk.
7. SHAP explains which features increased or decreased that risk.
8. The web dashboard shows the score, explanation, and trends.

## Project structure

```text
DiaPredict2.0/
├─ apps/
│  ├─ android/   # Android Health Connect sync app
│  ├─ api/       # Express + TypeScript backend
│  └─ web/       # React + Vite dashboard
├─ data/         # Training datasets
├─ models/       # Trained model artifacts and reports
├─ scripts/      # Python training and SHAP scripts
├─ logs/         # Local logs
└─ README.md
```

## Main technologies

### Android sync app

- Kotlin
- Android Studio
- Health Connect API

### Backend

- Node.js
- Express.js
- TypeScript

### Web dashboard

- React
- Vite
- TypeScript

### Machine learning and explainability

- Python
- scikit-learn
- RandomForestClassifier
- SHAP / Tree SHAP

## Machine learning model

The current prediction model is a **Random Forest Classifier** trained with scikit-learn.

### Model inputs

The current core model features are:

- `Glucose`
- `BloodPressure`
- `BMI`
- `Age`
- `Daily_Steps`

### Training dataset

The model is trained from the cleaned diabetes dataset located at:

- `data/diabetes_cleaned.csv`

### Training script

The Random Forest model is trained using:

- `scripts/train_random_forest.py`

### SHAP explanation script

Feature-level explainability is generated using:

- `scripts/explain_with_shap.py`

### Current model setup

The classifier is trained with:

- `n_estimators = 120`
- `max_depth = 6`
- `min_samples_leaf = 4`
- `random_state = 42`

### Stored model artifacts

The trained model and report are saved in:

- `models/diabetes-random-forest.joblib`
- `models/diabetes-random-forest.json`
- `models/training-report.json`

### Current evaluation metrics

Using the current saved model configuration, the reported metrics are approximately:

- Accuracy: `75.97%`
- Precision: `68.09%`
- Recall: `59.26%`
- F1 Score: `63.37%`
- ROC-AUC: `81.15%`

These numbers describe the trained baseline model and should not be treated as clinical validation.

## Explainable AI

DiaPredict uses **SHAP**, specifically **Tree SHAP**, to explain the Random Forest prediction.

This means the dashboard can show:

- the model's **base risk**
- which features **increased** the user's predicted risk
- which features **decreased** the user's predicted risk
- features that had **little or no visible effect**

The system uses SHAP to improve transparency and interpretability so the user does not only see a final percentage score.

## Backend behavior

The backend is responsible for:

- receiving synced health records
- storing record history
- tracking sync state
- accepting manual feature overrides
- building daily summaries and trend data
- extracting model inputs
- invoking SHAP
- formatting the response used by the dashboard

### Data storage

The backend persists local data in:

- `apps/api/data/store.json`

This file stores:

- synced records
- sync state
- provider connection state
- manual input overrides
- deduplication keys

## Web dashboard

The dashboard currently shows:

- diabetes risk score
- risk category
- feature-level SHAP explanation
- selected feature inputs sent to the model
- sync status
- metric trend graphs

The dashboard is designed for interpretability rather than raw data exploration only.

## Android app

The Android app acts as a **bridge**, not as a full prediction interface.

Its job is to:

- request Health Connect permission
- read supported records
- upload them to the backend
- optionally send user-entered values such as age

It is not the primary analysis UI; the main explanation and risk visualization happen in the web dashboard.

## Running the project

## 1. Install dependencies

From the project root:

```powershell
cd D:\DiaPredict2.0
npm.cmd install
```

## 2. Start the API

```powershell
cd D:\DiaPredict2.0\apps\api
npm.cmd run dev
```

The API runs by default at:

- [http://localhost:4000](http://localhost:4000)

Health check:

- [http://localhost:4000/health](http://localhost:4000/health)

## 3. Start the web dashboard

In another terminal:

```powershell
cd D:\DiaPredict2.0\apps\web
npm.cmd run dev
```

The web app runs by default at:

- [http://localhost:5173](http://localhost:5173)

## 4. Run the Android sync app

1. Open `apps/android` in Android Studio.
2. Connect an Android phone with Health Connect installed.
3. Ensure Samsung Health is sharing data to Health Connect.
4. Update the API base URL in:
   - `apps/android/app/src/main/java/com/diapredict/android/ApiClient.kt`
5. Run the app on the phone.
6. Grant permissions.
7. Tap **Sync Now**.
8. Refresh the web dashboard.

## Workspace scripts

From the project root, you can also use:

```powershell
npm.cmd run dev:api
npm.cmd run dev:web
npm.cmd run build
```

## API endpoints

### Sync

- `POST /api/v1/sync/batch`

Uploads a batch of Health Connect records from the Android sync app.

### Summary

- `GET /api/v1/dashboard/summary`

Returns:

- provider connection state
- latest sync metadata
- diabetes prediction
- latest metrics
- daily summary
- feature snapshot
- SHAP explanation

### Timeline

- `GET /api/v1/dashboard/timeline`

Returns aggregated timeline data for a selected metric and time window.

### Manual feature input

- `POST /api/v1/user/features`

Stores manually entered feature values such as age, glucose, blood pressure, BMI, or daily steps when available.

### What-if simulation

- `POST /api/v1/predict/simulate`

Runs a temporary prediction using simulated inputs without permanently changing stored data.

## Important limitations

This project has several important limitations:

- It is **not a medical diagnosis system**.
- The model is based on a cleaned diabetes dataset that does not perfectly match smartwatch-native data.
- Some inputs like glucose or blood pressure may not be available from the wearable pipeline and may require manual entry.
- The current heuristic adjustments for sleep, hydration, oxygen, and activity are supportive rules, not clinically validated model weights.
- The system has **not been clinically validated**.

## Recommended wording for reports and demos

It is safest to describe DiaPredict as:

> A wearable-assisted diabetes risk prediction and explainability system for preventive awareness.

Avoid describing it as:

- a diagnostic tool
- a replacement for clinical screening
- a medically validated diabetes detector

## Future scope

Possible future improvements include:

- using more wearable-compatible datasets
- replacing heuristic rules with clinically grounded or learned features
- adding more metrics such as sleep quality or resting heart rate
- validating the model clinically
- extending the same architecture to other chronic diseases
- packaging the experience into a stronger mobile-first product

## Disclaimer

DiaPredict is an academic / prototype software project for health risk estimation and explainability. It should be used only for educational, research, or preventive awareness purposes and not as a substitute for professional medical diagnosis or treatment.
