#!/bin/zsh
# Копирует интерфейс Пинакеса с компьютера в APK и подключает Android-мост (запускать перед сборкой)
set -e
cd "$(dirname "$0")"
UI="../../desktop/ui"; OUT="../app/src/main/assets/www"
rm -rf "$OUT"; mkdir -p "$OUT"
cp -R "$UI"/. "$OUT"/
cp android-shim.js android.css "$OUT"/
python3 - "$OUT/index.html" <<'PY'
import sys,re
p=sys.argv[1]; s=open(p,encoding='utf8').read()
s=s.replace('<meta name="viewport" content="width=device-width,initial-scale=1">','<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">')
s=s.replace('<link rel="stylesheet" href="style.css">','<link rel="stylesheet" href="style.css">\n<link rel="stylesheet" href="android.css">')
s=s.replace('<script src="lib/jszip.min.js"></script>','<script src="android-shim.js"></script>\n<script src="lib/jszip.min.js"></script>',1)
open(p,'w',encoding='utf8').write(s)
PY
echo "интерфейс скопирован: $(du -sh "$OUT" | cut -f1)"
