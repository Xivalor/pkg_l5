# Берём официальный образ nginx
FROM nginx:alpine

# Удаляем стандартные страницы
RUN rm -rf /usr/share/nginx/html/*

# Копируем файлы проекта в директорию веб-сервера
COPY . /usr/share/nginx/html

# По умолчанию Nginx слушает 80 порт, expose его
EXPOSE 80

# Команда запуска
CMD ["nginx", "-g", "daemon off;"]
