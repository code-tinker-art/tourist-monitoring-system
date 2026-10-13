# Backend operator access

The operations dashboard is protected by an operator PIN. Set `OPERATOR_PIN` in the same terminal that starts the backend, then restart it.

PowerShell:

```powershell
$env:OPERATOR_PIN = "choose-a-long-private-pin"
npm start
```

Command Prompt:

```bat
set OPERATOR_PIN=choose-a-long-private-pin
npm start
```

Do not commit a real PIN. The backend keeps operator sessions in memory for up to eight hours and rate-limits repeated failed PIN attempts. Configure HTTPS for access over an untrusted network; the PIN and bearer session must not be sent over plain HTTP.

This PIN gate is for a prototype only. Do not use it for real government or visitor records without a reviewed identity provider, role-based access, MFA, audited access, encrypted persistent storage, and an approved deployment/security review. Visitor records are currently stored in CSV files.

Risk-zone settings are saved to `../data/risk-config.json` when an authenticated operator saves them. Alert workflow updates and timestamped history are stored in `../data/alerts.csv`.
