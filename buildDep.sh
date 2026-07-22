#!/bin/sh
cd /home/djordje/dev/thrilla
mv ~/HonSync/thrilla-app.zip .
unzip -o thrilla-app.zip
rm -rf dist node_modules/.vite
npm run build:signet
sudo rm -rf /var/www/thrilla-signet/dist/*
sudo cp -r dist/* /var/www/thrilla-signet/dist/
