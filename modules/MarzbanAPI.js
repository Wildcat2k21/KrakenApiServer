const axios = require('axios');
require('dotenv').config();

// Переменные для хранения чувствительных данных
const MARZBAN_URL = process.env.MARZBAN_URL;
const USERNAME = process.env.USERNAME;
const PASSWORD = process.env.PASSWORD;

class MarzbanAPI {

    // Метод для получения токена авторизации
    static async GET_AUTH_TOKEN() {
        
        const boundary = '---------------------------';
        // Формируем тело запроса с использованием boundary
        let body = `
-----------------------------
Content-Disposition: form-data; name="username"

${USERNAME}
-----------------------------
Content-Disposition: form-data; name="password"

${PASSWORD}
-----------------------------
Content-Disposition: form-data; name="grant_type"

password
-------------------------------`;

        // Вернем исходное форматирование
        body = body.replace(/\n/g, "\r\n"); // Заменяем все переносы строк на \r\n
        body = body.replace(/\s{8}/g, boundary); // Восстанавливаем границы

        // Отправляем запрос
        const response = await axios.post(`${MARZBAN_URL}/api/admin/token`, body, {
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Priority': 'u=0',
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache'
            }
        });

        // Выводим полученный токен
        return response.data.access_token;
    }

    static async GET_USER(user_id) {
        const token = await MarzbanAPI.GET_AUTH_TOKEN();
        const response = await axios.get(`http://5.35.84.41:8000/api/user/${user_id}/`, {
            "credentials": "include",
            "headers": {
                "Accept": "*/*",
                'Authorization': `Bearer ${token}`,
                "Priority": "u=0",
                "Pragma": "no-cache",
                "Cache-Control": "no-cache"
            }
        });

        return response.data;
    }

    static async DELETE_USER(user_id){
        const token = await MarzbanAPI.GET_AUTH_TOKEN();
        const response = await axios.delete(`${MARZBAN_URL}/api/user/${user_id}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': '*/*',
                'Priority': 'u=0'
            }
        });

        return response.data;
    }

    // Метод для создания нового пользователя
    static async CREATE_USER(userData) {
        const token = await MarzbanAPI.GET_AUTH_TOKEN();
        const response = await axios.post(`${MARZBAN_URL}/api/user`, userData, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Priority': 'u=0',
                "Accept-Language": "ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3",
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache'
            }
        });

        return response.data;
    }
}

// Экспорт класса для использования в других файлах
module.exports = MarzbanAPI;