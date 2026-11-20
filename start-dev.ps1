# Starts the whole chess reviewer locally in 3 windows: API, worker, website.
#
#   .\start-dev.ps1          -> uses your Aiven Postgres + Kafka (from the .env files)
#   .\start-dev.ps1 -Local   -> runs Postgres + Kafka in Docker on this PC (no Aiven needed)
param([switch]$Local)
$root = $PSScriptRoot

# Env vars set here win over the .env files (python-dotenv never overrides them).
$envSetup = ''
if ($Local) {
    Write-Host 'Starting local Postgres + Kafka in Docker...' -ForegroundColor Cyan
    docker compose -f "$root\docker-compose.yaml" up -d
    if (-not $?) { Write-Host 'Docker failed - is Docker Desktop running?' -ForegroundColor Red; exit 1 }

    Write-Host 'Waiting for Kafka to accept connections...' -ForegroundColor Cyan
    for ($i = 0; $i -lt 60; $i++) {
        if ((Test-NetConnection localhost -Port 9092 -WarningAction SilentlyContinue).TcpTestSucceeded) { break }
        Start-Sleep -Seconds 2
    }
    Start-Sleep -Seconds 5   # broker needs a moment after the port opens

    $envSetup = @'
$env:DATABASE_URL='postgresql+psycopg2://chess_user:password123@localhost:5432/chess_data'
$env:KAFKA_URL='localhost:9092'
$env:KAFKA_SECURITY_PROTOCOL='PLAINTEXT'
$env:RATE_LIMIT_GAMES='100'
'@
}

# 1) FastAPI gateway on :8080
Start-Process powershell -ArgumentList '-NoExit', '-Command', @"
`$host.UI.RawUI.WindowTitle = 'Chess API :8080'
cd '$root\FastApi-Backend'
.\.venv\Scripts\Activate.ps1
pip install -q -r requirements.txt
$envSetup
uvicorn main:app --reload --port 8080
"@

# 2) Stockfish worker (lower depth = faster while testing)
Start-Process powershell -ArgumentList '-NoExit', '-Command', @"
`$host.UI.RawUI.WindowTitle = 'Chess worker'
cd '$root\ai-worker'
pip install -q -r requirements.txt
`$env:ENGINE_DEPTH='14'
$(if ($Local) { $envSetup } else { "`$env:KAFKA_URL='chess-kafka-siddiquiyahya796-e171.b.aivencloud.com:23570'; `$env:KAFKA_SECURITY_PROTOCOL='SSL'" })
python main.py
"@

# 3) Website on :5173
Start-Process powershell -ArgumentList '-NoExit', '-Command', @"
`$host.UI.RawUI.WindowTitle = 'Chess website :5173'
cd '$root\frontend'
npm install --silent
npm run dev
"@

Start-Sleep -Seconds 10
Start-Process 'http://localhost:5173'
