#!/bin/sh
set -eu
umask 077
dir=/opt/yaoyao-ai/backups
file="$dir/yaoyao-$(date -u +%Y%m%dT%H%M%SZ).dump"
mkdir -p "$dir"
docker exec yaoyao-postgres pg_dump -U yaoyao_admin -d yaoyao -Fc > "$file.tmp"
# Inspect archive structure before promoting the backup.
docker exec -i yaoyao-postgres pg_restore --list < "$file.tmp" >/dev/null
mv "$file.tmp" "$file"
# This dedicated directory contains only YAOYAO DB dumps and Nginx snapshots.
find "$dir" -maxdepth 1 -name 'yaoyao-*.dump' -mtime +7 -delete
# Cap total retained dump bytes at50MiB, always retaining the newest dump.
python3 - "$dir" <<'PY'
from pathlib import Path
import sys
files=sorted(Path(sys.argv[1]).glob('yaoyao-*.dump'),key=lambda p:p.stat().st_mtime,reverse=True)
total=0
for i,p in enumerate(files):
 total+=p.stat().st_size
 if i and total>50*1024*1024:p.unlink()
PY
