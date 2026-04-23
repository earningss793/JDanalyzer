#!/bin/sh
# .env 파일이 있으면 자동으로 읽음
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

if [ -z "$OPENAI_API_KEY" ]; then
  echo "Error: OPENAI_API_KEY is not set" >&2
  exit 1
fi

cat > config.js <<EOF
window.OPENAI_API_KEY = "${OPENAI_API_KEY}";
EOF
echo "config.js generated."
