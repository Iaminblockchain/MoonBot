#!/bin/bash

if grep -r "console\." --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --exclude="config.ts" ./src; then
  echo "::error::Found console logging statements. Please use winston logger instead."
  exit 1
fi 