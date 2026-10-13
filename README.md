# Tourist Monitoring System

A prototype tourist safety and monitoring system built as a multi-part Node.js app with a central backend, a live dashboard, a mobile interface, and shared data files.

## Project overview

This repository is organized into four main areas:

- backend/ — real-time monitoring backend with WebSocket updates, risk configuration, anomaly detection, and blockchain-style record tracking
- dashboard/ — operator dashboard served as a static web app
- mobile-app/ — mobile-friendly visitor interface
- data/ — CSV and JSON configuration files used by the backend

## Validity check

The repository structure is internally consistent for a small Node-based prototype:

- Each app folder contains its own server entry point (`server.js`)
- The backend declares a valid `package.json` and dependency set (`ws`)
- The backend code references files that exist in the repository (`blockchain.js`, `database.js`, `anomalyDetection.js`, and the `data/` folder)
- The project includes sample data files under `data/` for alerts, tourists, and risk rules
- The app is designed to be run locally in separate processes, which matches the layout of the codebase

This is a functional prototype rather than a production-grade system, and it is best treated as a demo/POC.

## Technology stack

- Node.js
- JavaScript / HTML / CSS
- WebSockets for live dashboard updates
- Local CSV/JSON persistence for demo data

## Repository structure

```text
.
├── backend/
│   ├── README.md
│   ├── anomalyDetection.js
│   ├── blockchain.js
│   ├── database.js
│   ├── package.json
│   ├── package-lock.json
│   ├── server.js
│   └── node_modules/   (installed dependencies)
├── dashboard/
│   ├── dashboard.js
│   ├── index.html
│   ├── server.js
│   └── styles.css
├── mobile-app/
│   ├── app.js
│   ├── index.html
│   ├── logo.png
│   ├── server.js
│   └── styles.css
├── data/
│   ├── alerts.csv
│   ├── risk-config.json
│   └── tourists.csv
└── README.md
```

## Quick start

### 1) Backend

```bash
cd backend
npm install
export OPERATOR_PIN="choose-a-long-private-pin"
npm start
```

On Windows PowerShell:

```powershell
cd backend
npm install
$env:OPERATOR_PIN = "choose-a-long-private-pin"
npm start
```

The backend runs on:

- HTTP: http://localhost:3000
- WebSocket: ws://localhost:3001

### 2) Dashboard

```bash
cd dashboard
node server.js
```

Open: http://localhost:2000

### 3) Mobile app

```bash
cd mobile-app
node server.js
```

Open: http://localhost:5000

## Data files

- `data/risk-config.json` stores configured risk thresholds and zones
- `data/alerts.csv` stores alert history and workflow records
- `data/tourists.csv` stores tourist information used by the backend

## Security and operational notes

- The backend uses an operator PIN for access to operational functions
- The prototype stores some state in local files and in memory
- This is suitable for a demo or proof of concept, not for production deployment without stronger authentication, encryption, and auditing

## License

No explicit license file is included in this repository.
