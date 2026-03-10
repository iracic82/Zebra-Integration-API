#!/bin/sh
# Replace placeholders with environment variables
sed -i "s|__API_URL__|${API_URL:-https://zebra-api.highvelocitynetworking.com}|g" /usr/share/nginx/html/index.html
sed -i "s|__API_KEY__|${API_KEY:-}|g" /usr/share/nginx/html/index.html
exec nginx -g 'daemon off;'
