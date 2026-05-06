#!/bin/bash
# Generate self-signed SSL certificate for HTTPS support
if [ ! -f /etc/pki/tls/certs/selfsigned.crt ]; then
  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout /etc/pki/tls/certs/selfsigned.key \
    -out /etc/pki/tls/certs/selfsigned.crt \
    -subj "/C=IN/ST=Maharashtra/L=Mumbai/O=Telemedicine/CN=telemedicine-prod.eba-tmusme2h.ap-south-1.elasticbeanstalk.com"
  chmod 600 /etc/pki/tls/certs/selfsigned.key
  chmod 644 /etc/pki/tls/certs/selfsigned.crt
  echo "Self-signed SSL certificate generated."
else
  echo "SSL certificate already exists."
fi
