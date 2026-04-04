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
//ИМПОРТ КОНФИГУРАЦИИ ВЫЗЫВАЕТ ПРОБЛЕМУ

//получение переменных
const {XUI_DASHBOARD_URL, XUI_ADMIN_LOGIN, XUI_ADMIN_PASSWD} =  process.env;
const XUI_HOSTNAME = process.env.XUI_HOSTNAME;

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
        
        //ТУТ ХУЙНЯ КАКАЯ-ТО
        const inboundResponse = await fetchWithCookies(`${XUI_DASHBOARD_URL}/panel/inbound/list`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
            }
        });

        const inboundData = await inboundResponse.json();

        // СОЗДАЕМ КОНФИГУРАЦИЮ ЗАРАНЕЕ, ТОГДА УСЛОВИЕ ПРЕРЕВЕТСЯ НА ДАННОЙ ПРОВЕРКЕ
        if(inboundData.obj.length){
            this.inboundId = inboundData.obj[0].id;
            return WriteInLogFile("Найдена конфигурация подключения ℹ️");
        }

        // ОСТАНАВЛИВАЕМ ВЫПОЛНЕНИЕ
        throw new Error("КОНФИГУРАЦИЯ НЕ НАЙДЕНА ❗️");

        // --- КОД НИЖЕ НУЖНО ДОРАБОТАТЬ, ЧТОБЫ ИНИЦИАЛИЗИРОВАТЬ КОНФИГУРАЦИЮ АВТОМАТИЧЕСКИ
        // --- В ТЕКУЩЕЙ РЕАЛИЗАЦИИ ОНА ДОЛЖНА БЫТЬ ЗАРАНЕЕ СОЗДАНА

        // const config_json = await import("../x-ray-config.json", {
        //     assert: { type: "json" },
        // });

        // //получение сертификата
        // const {privateKey, publicKey} = (await this.GetNewCert()).obj;

        // //установка параметров сервера
        // const config = {...config_json.default}
        // config.streamSettings.realitySettings.privateKey = privateKey;
        // config.streamSettings.realitySettings.publicKey = publicKey;
        // config.port = Number(XUI_BASE_SUB_PORT);

        // //установка коротких id
        // // config.streamSettings.realitySettings.shortIds = [
        // //     0, 0, 0, 0, 0, 0, 0, 0 
        // // ].map(_ => nanoid(Math.ceil(Math.random() * 13) + 3));

        // //преобразование параметров в строку
        // const stringConfigParam = Object.keys(config).map(key => `${key}=${typeof config[key] === 'object' ? encodeURIComponent(JSON.stringify(config[key], null, 2)) : config[key]}`).join('&')

        // //инициализация подписки
        // const response = await fetchWithCookies(`${XUI_DASHBOARD_URL}/panel/inbound/add`, {
        //     method: "POST",
        //     headers: {
        //         "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        //     },
        //     body: stringConfigParam
        // });

        // const data = await response.json();

        // if(!data.success) throw new Error("Не удалось инициализировать конфигурацию ❗️");

        // //установка идентификатора подключения
        // WriteInLogFile("Подключение создано 🎉");
        // this.inboundId = data.obj.id;

        // //добавление нулевой подписки
        // await this.CreateUser({email: "root", totalGB: 0, expiryTime: 0});

        // return data;
    }

    //создание пользователя
    static CreateUser = async ({ email, totalGB, expiryTime, reset = 0 }) => {

        if(!this.inboundId) throw new Error("Подключение не инициализировано ❗️");

        //авторизация
        await this.MakeAuthRequest();

        //объект пользователя
        const userObject = {
            id: this.inboundId,
            settings: {
                clients: [{
                    password: `${email}_${uuidv4()}`,
                    email,
                    limitIp: 0,
                    totalGB,
                    expiryTime,
                    enable: true,
                    tgId: "",
                    subId: nanoid(16),
                    reset,
                }]
            }
        }

        // //объект пользователя
        // const userObject = {
        //     id: this.inboundId,
        //     settings: {
        //         clients: [{
        //             id: uuidv4(),
        //             flow: "xtls-rprx-vision",
        //             email,
        //             limitIp: 0,
        //             totalGB,
        //             expiryTime,
        //             enable: true,
        //             tgId: "",
        //             subId: nanoid(16),
        //             reset: 0
        //         }]
        //     }
        // }

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

    // создание строки подключения пользователя
    static CreateConnection = (client, streamSettings, protocol, port, remark) => {

        const connectionParams = {
            type: streamSettings.network, // tcp
            security: streamSettings.security, // tls
            fp: streamSettings.tlsSettings?.settings?.fingerprint,
            alpn: streamSettings.tlsSettings?.alpn?.join(','),
            sni: streamSettings.tlsSettings?.serverName
        };

        // удаляем undefined/null параметры
        const query = Object
            .entries(connectionParams)
            .filter(([_, value]) => value !== undefined && value !== null && value !== '')
            .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
            .join('&');

        const connection =
            `${protocol}://${client.password}@${XUI_HOSTNAME}:${port}?${query}#${encodeURI(`${remark} - ${client.email}`)}`;

        return connection;
    }

    //получение пользователя
    static GetUser = async (email) => {

        if(!this.inboundId) throw new Error("Подключение не инициализировано ❗️");

        //авторизация
        await this.MakeAuthRequest();

        //получение списка пользователей

        //ТУТ ХУЙНЯ КАКАЯ-ТО
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