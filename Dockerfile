FROM nginx:alpine
COPY dist /usr/share/nginx/html
RUN chmod -R a+rX /usr/share/nginx/html
COPY default.conf.template /etc/nginx/templates/default.conf.template
ENV DOMAIN=_
ENV NEZHA=http://127.0.0.1:8008/
ENV NEZHA_ORIGIN=http://127.0.0.1:8008
EXPOSE 80
