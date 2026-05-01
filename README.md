# DiaPredict 2.0

A smaller Samsung Health + Health Connect project with three parts:

- `apps/android`: Android app that reads Health Connect and uploads data
- `apps/api`: one-file Express API
- `apps/web`: small React dashboard

## Flow

```text
Samsung Health -> Health Connect -> Android app -> API -> Web dashboard
```

## Run

```powershell
cd D:\DiaPredict2.0
npm.cmd install
```

API:

```powershell
cd D:\DiaPredict2.0\apps\api
npm.cmd run dev
```

Web:

```powershell
cd D:\DiaPredict2.0\apps\web
npm.cmd run dev
```

## Android

1. Open `apps/android` in Android Studio.
2. Update `BASE_URL` in `apps/android/app/src/main/java/com/diapredict/android/ApiClient.kt`.
3. Run the app on an Android phone with Health Connect.
4. Make sure Samsung Health data appears in Health Connect.
5. Tap `Grant Access`, then `Sync Now`.

## Endpoints

- `POST /api/v1/sync/batch`
- `GET /api/v1/dashboard/summary`
- `GET /api/v1/dashboard/timeline`


