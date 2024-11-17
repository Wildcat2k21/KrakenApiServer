import dotenv from 'dotenv';
dotenv.config();
import fetch from 'node-fetch';
import { CookieJar } from 'tough-cookie';
import fetchCookie from 'fetch-cookie';
import { v4 as uuidv4 } from 'uuid';
import { nanoid } from 'nanoid';
import Other from './Other.js';

const {WriteInLogFile} = Other;

//Модуль протестирован и готов к работе
//Примечания время подписок в unix миллисекундах, получение пользователя возвращает массив
//Метод авторизации вызывает своб собственную ошибку
//МЕТОДЫ ДОСТУПНЫ ТОЛЬКО ПОСЛЕ ИНИЦИАЛИЗАЦИИ КОНФИГА

//получение переменных
const {XUI_DASHBOARD_URL, XUI_ADMIN_LOGIN, XUI_ADMIN_PASSWD, XUI_BASE_SUB_PORT} =  process.env;
const XUI_IP_ADDR = XUI_DASHBOARD_URL.match(/\d+\.\d+\.\d+\.\d+/)[0];

//получение кук
const jar = new CookieJar();
const fetchWithCookies = fetchCookie(fetch, jar);

class XUI_API{

    //идентификатор подписки
    static inboundId = null;

    //получение куков авторизации
    static findAuthCookie = async () => {
        const cookies = await jar.getCookies(XUI_DASHBOARD_URL);
        //'3x-ui' - кука сессии
        return cookies.find(cookie => cookie.key === '3x-ui');
    }

    static MakeAuthRequest = async () => {

        //получение куков авторизации для проверки
        const authCookie = await this.findAuthCookie();

        //выходим если куки авторизации имеются
        if(authCookie) return;

        const params = new URLSearchParams();
        params.append("username", XUI_ADMIN_LOGIN); // Замените на реальный логин
        params.append("password", XUI_ADMIN_PASSWD); // Замените на реальный пароль

        const response = await fetchWithCookies(`${XUI_DASHBOARD_URL}/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
            },
            body: params.toString(),
        });

        const data = await response.json();

        // Проверяем, что запрос прошел успешно
        if(!data.success) throw new Error("Авторизация не удалась");
        
        return data;
    }

    //получение токена сертификата
    static GetNewCert = async () => {

        //получение куков авторизации для проверки
        const authCookie = await this.findAuthCookie();

        //выходим если куки авторизации имеются
        if(!authCookie) throw new Error("Не удалось получить сертификат. Куки авторизации не найдены");

        const response = await fetchWithCookies(`${XUI_DASHBOARD_URL}/server/getNewX25519Cert`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            }
        });

        const data = await response.json();

        // Проверяем, что запрос прошел успешно
        if(!data.success) throw new Error("Не удалось получить сертификат");

        // Получим данные сертификата
        return data;
    }

    //инициализация сервера
    static InitXrayConfig = async () => {

        //авторизация
        await this.MakeAuthRequest();

        //проверка наличия инстанса конфигурации
        const inboundResponse = await fetchWithCookies(`${XUI_DASHBOARD_URL}/panel/inbound/list`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
            }
        });

        const inboundData = await inboundResponse.json();

        if(inboundData.obj.length){
            this.inboundId = inboundData.obj[0].id;
            return WriteInLogFile("Найдена конфигурация подключения ℹ️");
        }

        const config_json = await import("../x-ray-config.json", {
            assert: { type: "json" },
        });

        //получение сертификата
        const {privateKey, publicKey} = (await this.GetNewCert()).obj;

        //установка параметров сервера
        const config = {...config_json.default}
        config.streamSettings.realitySettings.privateKey = privateKey;
        config.streamSettings.realitySettings.publicKey = publicKey;
        config.port = Number(XUI_BASE_SUB_PORT);

        //установка коротких id
        config.streamSettings.realitySettings.shortIds = [
            0, 0, 0, 0, 0, 0, 0, 0 
        ].map(_ => nanoid(Math.ceil(Math.random() * 13) + 3));

        //преобразование параметров в строку
        const stringConfigParam = Object.keys(config).map(key => `${key}=${typeof config[key] === 'object' ? encodeURIComponent(JSON.stringify(config[key], null, 2)) : config[key]}`).join('&')

        //инициализация подписки
        const response = await fetchWithCookies(`${XUI_DASHBOARD_URL}/panel/inbound/add`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            },
            body: stringConfigParam
        });

        const data = await response.json();

        if(!data.success) throw new Error("Не удалось инициализировать конфигурацию ❗️");

        //установка идентификатора подключения
        WriteInLogFile("Подключение создано 🎉");
        this.inboundId = data.obj.id;

        //добавление нулевой подписки
        await this.CreateUser({email: "root", totalGB: 0, expiryTime: 0});

        return data;
    }

    //создание пользователя
    static CreateUser = async ({email, totalGB, expiryTime}) => {

        if(!this.inboundId) throw new Error("Подключение не инициализировано ❗️");

        //авторизация
        await this.MakeAuthRequest();

        //объект пользователя
        const userObject = {
            id: this.inboundId,
            settings: {
                clients: [{
                    id: uuidv4(),
                    flow: "xtls-rprx-vision",
                    email,
                    limitIp: 0,
                    totalGB,
                    expiryTime,
                    enable: true,
                    tgId: "",
                    subId: nanoid(16),
                    reset: 0
                }]
            }
        }

        //преобразование параметров в строку
        const stringUserParam = Object.keys(userObject).map(param => `${param}=${encodeURIComponent(JSON.stringify(userObject[param], null, 2))}`).join('&');

        //создание пользователя
        const response = await fetchWithCookies(`${XUI_DASHBOARD_URL}/panel/inbound/addClient`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            },
            body: stringUserParam
        });

        const data = await response.json();

        if(!data.success) throw new Error(`Ошибка при создании пользователя "${email}" ❗️`);

        //возвращаем созданного пользователя
        WriteInLogFile(`Пользователь "${email}" создан 🎉`);
        const thisClient = await this.GetUser(email);

        return thisClient[0];
    }

    //создание строки подключения пользователя
    static CreateConnection = (client, streamSettings, protocol, port, remark) => {

        //параметры строки подключения
        const connectionParams = {
            security: streamSettings.security,
            pbk: streamSettings.realitySettings.settings.publicKey,
            fp: streamSettings.realitySettings.settings.fingerprint,
            sni: streamSettings.realitySettings.serverNames[0],
            sid: streamSettings.realitySettings.shortIds[0],
            spx: streamSettings.realitySettings.settings.spiderX,
            flow: client.flow
        }

        //создани строки подключения
        const connection = `${protocol}://${client.id}@${XUI_IP_ADDR}:${port}?type=${streamSettings.network}&${Object.keys(connectionParams).map(key => `${key}=${encodeURIComponent(connectionParams[key])}`).join('&')}#${encodeURI(`${remark} - ${client.email}`)}`;
        return connection;
    }

    //получение пользователя
    static GetUser = async (email) => {

        if(!this.inboundId) throw new Error("Подключение не инициализировано ❗️");

        //авторизация
        await this.MakeAuthRequest();

        //получение списка пользователей
        const response = await fetchWithCookies(`${XUI_DASHBOARD_URL}/panel/inbound/list`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
            }
        });

        const data = await response.json();

        //проверка условия возврата пользователей
        if(data.success){
            const clients = JSON.parse(data.obj[0].settings).clients;
            const streamSettings = JSON.parse(data.obj[0].streamSettings);
            const protocol = data.obj[0].protocol;
            const remark = data.obj[0].remark;
            const port = data.obj[0].port;

            //возврат одного пользователя
            if(email) {

                //информация о конкретном пользователе
                const current = clients.find(c => c.email === email);

                return data.obj[0].clientStats.filter(client => client.email === email).map(client => ({
                    email: client.email,
                    data_limit: client.total,
                    used_traffic: client.up + client.down,
                    expire: Math.ceil(current.expiryTime / 1000),
                    uid: current.id,
                    connection_string: this.CreateConnection(current, streamSettings, protocol, port, remark)
                }));
            }

            //возврат всех пользователей
            return data.obj[0].clientStats.map(client => {

                const current = clients.find(c => c.email === client.email);

                return {
                    email: client.email, //имя пользователя
                    data_limit: client.total, //трафик по подписке
                    used_traffic: client.up + client.down, //использовано трафика в байтах
                    expire: Math.ceil(current.expiryTime / 1000),
                    uid: current.id,
                    connection_string: this.CreateConnection(current, streamSettings, protocol, port, remark)
                }
            });            
        }
    }

    //удаление пользователя (последний пользователь не может быть удален)
    static DeleteUser = async (email) => {
        
        if(!this.inboundId) throw new Error("Подключение не инициализировано ❗️");

        //авторизация
        await this.MakeAuthRequest();

        //получение информации о пользваотеле
        const currentUser = await this.GetUser(email);

        //проверка наличия пользователя
        if(!currentUser.length) return;

        const user_id = currentUser[0].uid;

        //удаление пользователя
        const response = await fetchWithCookies(`${XUI_DASHBOARD_URL}/panel/inbound/${this.inboundId}/delClient/${user_id}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            }
        });

        const data = await response.json();

        if(!data.success) throw new Error(`Ошибка при удалении пользователя "${email}" ❗️`);

        //возвращаем результат
        WriteInLogFile(`Пользователь "${email}" удален 🎉`);
        return data;
    }
}

export default XUI_API;

// const axios = require('axios');
// require('dotenv').config();

// // Переменные для хранения чувствительных данных
// const MARZBAN_URL = process.env.MARZBAN_URL;
// const USERNAME = process.env.MRZ_USERNAME;
// const PASSWORD = process.env.MRZ_PASSWORD;

// class MarzbanAPI {
//     // Метод для получения токена авторизации
//     static async GET_AUTH_TOKEN() {
//         const boundary = '---------------------------';
//         // Формируем тело запроса с использованием boundary
//         let body = `
// -----------------------------
// Content-Disposition: form-data; name="username"

// ${USERNAME}
// -----------------------------
// Content-Disposition: form-data; name="password"

// ${PASSWORD}
// -----------------------------
// Content-Disposition: form-data; name="grant_type"

// password
// -------------------------------`;

//         // Вернем исходное форматирование
//         body = body.replace(/\n/g, "\r\n"); // Заменяем все переносы строк на \r\n
//         body = body.replace(/\s{8}/g, boundary); // Восстанавливаем границы

//         // Отправляем запрос
//         const response = await axios.post(`${MARZBAN_URL}/api/admin/token`, body, {
//             headers: {
//                 'Content-Type': `multipart/form-data; boundary=${boundary}`,
//                 'Priority': 'u=0',
//                 'Pragma': 'no-cache',
//                 'Cache-Control': 'no-cache'
//             }
//         });

//         // Выводим полученный токен
//         return response.data.access_token;
//     }

//     static async GET_USER(user_id) {
//         const token = await MarzbanAPI.GET_AUTH_TOKEN();
//         const response = await axios.get(`${MARZBAN_URL}/api/user/${user_id}/`, {
//             "credentials": "include",
//             "headers": {
//                 "Accept": "*/*",
//                 'Authorization': `Bearer ${token}`,
//                 "Priority": "u=0",
//                 "Pragma": "no-cache",
//                 "Cache-Control": "no-cache"
//             }
//         });

//         return response.data;
//     }

//     static async DELETE_USER(user_id){
//         const token = await MarzbanAPI.GET_AUTH_TOKEN();
//         const response = await axios.delete(`${MARZBAN_URL}/api/user/${user_id}`, {
//             headers: {
//                 'Authorization': `Bearer ${token}`,
//                 'Accept': '*/*',
//                 'Priority': 'u=0'
//             }
//         });

//         return response.data;
//     }

//     // Метод для создания нового пользователя
//     static async CREATE_USER(userData) {
//         const token = await MarzbanAPI.GET_AUTH_TOKEN();
//         const response = await axios.post(`${MARZBAN_URL}/api/user`, userData, {
//             headers: {
//                 'Authorization': `Bearer ${token}`,
//                 'Accept': 'application/json',
//                 'Content-Type': 'application/json',
//                 'Priority': 'u=0',
//                 "Accept-Language": "ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3",
//                 'Pragma': 'no-cache',
//                 'Cache-Control': 'no-cache'
//             }
//         });

//         return response.data;
//     }
// }

// // Экспорт класса для использования в других файлах
// module.exports = MarzbanAPI;