FROM nginx:alpine

# Copy static files to nginx html directory
COPY index.html /usr/share/nginx/html/
COPY dashboard.js /usr/share/nginx/html/
COPY data /usr/share/nginx/html/data
COPY scripts /usr/share/nginx/html/scripts

# Copy custom nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Expose port 80
EXPOSE 80

# Run nginx in foreground
CMD ["nginx", "-g", "daemon off;"]
