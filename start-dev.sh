#!/bin/bash
# Windows용 start-dev.bat 을 macOS용으로 옮긴 스크립트
# 실행 방법: chmod +x start-dev.sh 후 ./start-dev.sh

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# AppleScript 문자열 안에 안전하게 넣기 위해 백슬래시/따옴표를 이스케이프
escape_for_applescript() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

run_in_new_window() {
  local title="$1"
  local cmd="$2"
  local full_cmd="echo '=== ${title} ==='; ${cmd}"
  local escaped
  escaped="$(escape_for_applescript "$full_cmd")"

  osascript -e "tell application \"Terminal\"" \
            -e "activate" \
            -e "do script \"${escaped}\"" \
            -e "end tell"
}

# 1) Backend (Python/uvicorn)
run_in_new_window "Planit Backend" "cd '${DIR}'; python3 -m uvicorn server:app --reload"

# 2) Checklist (Gradle)
run_in_new_window "Planit Checklist" "cd '${DIR}/Planit-Web-Checklist-main'; ./gradlew bootRun"

# 3) Auth (Gradle)
run_in_new_window "Planit Auth" "cd '${DIR}/Planit-Web-Auth-Plan-Quiz-master/Planit-Web-Auth-Plan-Quiz-master/backend'; ./gradlew bootRun"

# 4) Frontend (npm)
run_in_new_window "Planit Frontend" "cd '${DIR}/frontend'; npm run dev"