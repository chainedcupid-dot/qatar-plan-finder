#!/usr/bin/env bash
# One-shot setup: puts Qatar Plan Finder on your GitHub, turns on the website, and runs the robot once.
set -euo pipefail
cd "$(dirname "$0")"
REPO=qatar-plan-finder

say(){ printf '\n\033[1;35m▶ %s\033[0m\n' "$*"; }

say "Checking tools"
need(){ command -v "$1" >/dev/null || { if command -v pacman >/dev/null; then sudo pacman -S --needed --noconfirm "$2"; elif command -v brew >/dev/null; then brew install "$2"; else echo "Please install $2"; exit 1; fi; }; }
need git git
need gh github-cli

say "Logging in to GitHub (a browser window may open)"
gh auth status >/dev/null 2>&1 || gh auth login --web --git-protocol https --scopes workflow
gh auth setup-git
ME=$(gh api user --jq .login)

say "Creating github.com/$ME/$REPO"
gh repo view "$ME/$REPO" >/dev/null 2>&1 || gh repo create "$REPO" --public --description "Compare every Ooredoo and Vodafone postpaid plan in Qatar"

say "Turning on the website"
gh api -X POST "repos/$ME/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 \
  || gh api -X PUT "repos/$ME/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 || true

say "Visitor counter (optional, free, no cookies)"
if [ -z "$(sed -n 's/.*"goatcounter": *"\([a-z0-9-]*\)".*/\1/p' config.json)" ]; then
  echo "  1. Sign up at https://www.goatcounter.com/signup (pick a short code, e.g. qatarplans)"
  command -v xdg-open >/dev/null && xdg-open https://www.goatcounter.com/signup >/dev/null 2>&1 || true
  read -rp "  2. Type your GoatCounter code here (or just press Enter to skip): " GC
  # Accept a plain code, a full https://CODE.goatcounter.com link, or the whole script snippet
  GC=$(echo "$GC" | tr 'A-Z' 'a-z' | sed -n 's#.*https\?://\([a-z0-9-]*\)\.goatcounter\.com.*#\1#p;t;p' | head -1 | tr -cd 'a-z0-9-')
  printf '{ "goatcounter": "%s" }\n' "$GC" > config.json
  [ -n "$GC" ] && echo "  Counter on. Your numbers: https://$GC.goatcounter.com"
fi

say "Uploading the code"
[ -d .git ] || git init -q -b main
git add -A
git -c user.name="$ME" -c user.email="$ME@users.noreply.github.com" commit -qm "Qatar Plan Finder + price robot" || true
git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$ME/$REPO.git"
git push -u origin main --force

say "Waking the robot up for its first price check"
for i in 1 2 3 4 5 6; do gh workflow run robot.yml -R "$ME/$REPO" >/dev/null 2>&1 && break; sleep 5; done
sleep 8
RUN=$(gh run list -R "$ME/$REPO" --workflow robot.yml --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN" -R "$ME/$REPO" --exit-status && OK=1 || OK=0

echo
if [ "$OK" = 1 ]; then
  printf '\033[1;32m✔ All done! Your site: https://%s.github.io/%s/\033[0m\n' "$ME" "$REPO"
  echo "  The robot checks prices every morning at 6:17 Qatar time. You'll get an email only if it gets lost."
  GCODE=$(sed -n 's/.*"goatcounter": *"\([a-z0-9-]*\)".*/\1/p' config.json)
  [ -n "$GCODE" ] && echo "  Visitor and click numbers: https://$GCODE.goatcounter.com"
else
  printf '\033[1;33m⚠ The site is up at https://%s.github.io/%s/ but the robot hit a snag on its first run.\033[0m\n' "$ME" "$REPO"
  echo "  See what happened: https://github.com/$ME/$REPO/issues  (send Claude a screenshot)"
fi
