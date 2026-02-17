#!/bin/bash
cd /home/kavia/workspace/code-generation/token-visualization-dashboard-10139/token_metrics_frontend
npm run build
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
   exit 1
fi

