#!/bin/sh
# The arguments come from the main process after the installer and staged bundle are verified.
set -eu
pid=$1
installed=$2
staging=$3
candidate="$staging/HaiA.app"
trap '/bin/rm -r "$staging"' EXIT
i=0
while [ "$i" -lt 120 ]; do
  i=$((i+1))
  if ! kill -0 "$pid" 2>/dev/null; then break; fi
  /bin/sleep 1
done
if kill -0 "$pid" 2>/dev/null; then exit 1; fi
if ! /usr/bin/osascript -l JavaScript "$staging/swap.js" "$installed" "$candidate"; then
  /usr/bin/open "$installed"
  /usr/bin/osascript -e 'display alert "HaiA 更新未完成" message "应用目录无法替换，已重新打开原版本。"'
  exit 1
fi
if ! /usr/bin/open "$installed"; then
  # If rollback fails, retain both bundles for recovery.
  trap - EXIT
  /usr/bin/osascript -l JavaScript "$staging/swap.js" "$installed" "$candidate"
  trap '/bin/rm -r "$staging"' EXIT
  /usr/bin/open "$installed"
  /usr/bin/osascript -e 'display alert "HaiA 更新未完成" message "新版本未能启动，已恢复原版本。"'
fi
