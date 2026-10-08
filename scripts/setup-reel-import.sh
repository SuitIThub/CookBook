#!/usr/bin/env bash
# One-time server setup for the Instagram reel import (Debian/Ubuntu).
#
#   bash scripts/setup-reel-import.sh            # venv in ~/reel-venv
#   bash scripts/setup-reel-import.sh /pfad/venv
#
# Installs ffmpeg + tesseract (German/English) via apt and yt-dlp +
# faster-whisper into a Python venv, pre-downloads the Whisper model, and
# prints the environment variables for the cookbook service.
set -euo pipefail

VENV="${1:-$HOME/reel-venv}"
MODEL="${WHISPER_MODEL:-small}"

echo "==> System packages (ffmpeg, tesseract, python venv)"
sudo apt-get update -qq
sudo apt-get install -y ffmpeg tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng python3-venv

echo "==> Python venv: $VENV"
python3 -m venv "$VENV"
"$VENV/bin/pip" install --upgrade --quiet pip
"$VENV/bin/pip" install --upgrade --quiet yt-dlp faster-whisper

echo "==> Whisper model '$MODEL' herunterladen (einmalig, ~500 MB für small)"
"$VENV/bin/python" -c "from faster_whisper import WhisperModel; WhisperModel('$MODEL', device='cpu', compute_type='int8')"

cat <<EOF

Fertig. In die systemd-Unit des Kochbuchs (z. B. per 'sudo systemctl edit cookbook.service'):

  [Service]
  Environment=REEL_PYTHON=$VENV/bin/python
  Environment=WHISPER_MODEL=$MODEL
  # optional, wenn Instagram anonyme Abrufe blockiert (Netscape-cookies.txt eines Instagram-Kontos):
  # Environment=INSTAGRAM_COOKIES=/home/$USER/instagram-cookies.txt

Danach: sudo systemctl restart cookbook.service
yt-dlp gelegentlich aktualisieren (Instagram ändert sich oft):
  $VENV/bin/pip install --upgrade yt-dlp
EOF
