#!/bin/sh
# Builds the extension: TypeScript → dist/, CSS parts → style.css.
# Needs TypeScript (npm i -g typescript, or set TSC to your tsc).
set -e
cd "$(dirname "$0")"
${TSC:-tsc} -p tsconfig.json
cat css/*.css > style.css
echo "build ok"
