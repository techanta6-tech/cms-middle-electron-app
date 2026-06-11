# CMS Middle Windows Service

Build the deployable service package from the repository root:

```powershell
yarn build:be:service
```

The artifact is created under `build-be-service`.

On the target Windows machine, copy `.env.example` to
`app\cms-middle-be\.env`, set production secrets, then open PowerShell as
Administrator:

```powershell
cd C:\CMS-Middle
.\install-service.ps1
```

Useful commands:

```powershell
.\cms-middle-service.exe status
.\cms-middle-service.exe restart
.\cms-middle-service.exe stop
.\uninstall-service.ps1
```

Runtime data and service logs are stored under `C:\ProgramData\CMS-Middle`.
