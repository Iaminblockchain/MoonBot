#!/bin/bash

# Get all files containing process.env
FILES=$(grep -r "process\.env" --include="*.ts" --include="*.tsx" src/ | cut -d: -f1 | sort | uniq)

# Define allowed files
ALLOWED_FILES=("src/config.ts")

# Check each file
for file in $FILES; do
  if [[ ! " ${ALLOWED_FILES[@]} " =~ " ${file} " ]]; then
    echo "::error::process.env is used in unauthorized file: $file"
    echo "This should only be used in: ${ALLOWED_FILES[*]}"
    echo "Please use the exported environment variables from index.ts instead."
    exit 1
  fi
done

echo "✅ All process.env usages are in authorized files" 