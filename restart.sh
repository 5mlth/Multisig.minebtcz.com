#!/bin/bash

echo "🔄 Restart Docker Stack..."

# Stop containers
docker compose down

# Rebuild + restart
docker compose up -d --build

# Show status
echo ""
echo "📊 Containers status:"
docker compose ps

echo ""
echo "✅ Done."
