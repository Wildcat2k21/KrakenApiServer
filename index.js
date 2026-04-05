import Entities from './modules/Entities.js';
import XUI_API from './modules/XUI_API.js';
import Response from './modules/Response.js';
import Database from './modules/Database.js';
import express from 'express';

const { USER, OFFER, SUB, PROMO } = Entities;

import dotenv from 'dotenv';
dotenv.config();

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Получаем путь к текущему файлу
const __filename = fileURLToPath(import.meta.url);

// Получаем путь к текущей директории
const __dirname = path.dirname(__filename);

// Пользовательские модули
import Time from './modules/Time.js';
import Other from './modules/Other.js';
import BotService from './modules/BotService.js';
import Data from './modules/Data.js';
import TimeShedular from './modules/TimeShedular.js';

const { WriteInLogFile, FormatBytes, EncodeBase62BigInt } = Other;
const { checkUserFields, checkOfferFields, checkConfigFields } = Data;

// Конфигурация
let config = null;

//основаная конфигурация
const PORT = process.env.PORT || 4015;
const DATABASE = process.env.DATABASE_NAME;
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID;

//экземпляр базы данных
const db = new Database(`${DATABASE}.db`);
const app = express();

// Инициализация базы данных
initConnection();

// примечание: Уже существуюшщие или отсутствующие заказы в пересоздании будут вызывать ошибку 409 или 404
// примечение: В подтверждении заказов, в случае наличия или отсутсвия заказов в Marzban будет 409 или 404
// примечание: В получении информации по заказе, в случае отсутсвия заказа в Marzban будет 404
// Данные ошибки не критические если база данных не была затронута
// Удаление пользователя (С мягким исключением)

// Инициализация сущностей
const user = new USER(db);
const offer = new OFFER(db);
const sub = new SUB(db);
const promo = new PROMO(db);

// Middleware для парсинга JSON-тел
app.use(express.json());

// Путь к файлу базы данных
const databasePath = path.join(__dirname, 'database.zip');

// Маршрут для скачивания базы данных
app.get('/database', (req, res) => {
    res.download(databasePath, 'database.zip', (err) => {
        if (err) {
            console.error('Ошибка при отправке файла:', err);
            res.status(500).send('Ошибка при скачивании файла');
        }
    });
});

// Регистрация пользователей
app.post('/user', async (req, res) => {

    const response = new Response(res);
    const body = req.body;

    try{
        const totalParticipants = await USER.COUNT();
        if(totalParticipants >= config.total_participants_limit){
            response.status(403, 'Достигнут лимит пользователей');
            return response.send();
        }

        // Проверка на поля пользователя
        checkUserFields(body);

        // Создание нового пользователя
        await USER.NEW(body);

        //уведомление пользователя о новом приглашении
        if(body.invited_with_code){
            //информирование пользователя о новом приглашении по коду
            const invitedBy = await USER.FIND([[{
                field: 'invite_code',
                exacly: body.invited_with_code
            }]], true);

            //сообщение для пользователя
            await BotService.NOTIFY([{
                id: invitedBy.telegram_id,
                message: `<b>Вашей реферальной ссылкой воспользовался пользователь: @${body.telegram} 🤝</b>/n/n
                Как только пользователь оформит платный заказ, ваша скидка вырастит на <b>${config.invite_discount}%</b>/n/n
                <b><u>Пригласите еще друга и получите любую подписку в подарок бесплатно 🎁</u></b>`
            }]);
        }

        //оповещение о новом пользователе
        await BotService.NOTIFY([{
            id: ADMIN_ID,
            message: `У вас новый пользователь:/n/n
            👤 @${body.telegram} — "${body.telegram}"/n/n
            👥 Всего пользователей: ${(totalParticipants + 1)}`
        }]);

        response.status(201, 'Создано')
        response.send();
    }
    catch(err){

        // Ошибки формата данных для пользователя
        if(err.dataCheck){
            response.status(417, err.message);
            return response.send();
        }

        //ошибка обработки телеграм сервиса
        if(err.response){
            //статус и сообщение
            const statusCode = err.response.statusCode;
            const errorMessage = err.response.data;
            
            WriteInLogFile(new Error(`Telegram service error on "User": ${statusCode} ${errorMessage}`));
            response.status(statusCode, 'Что-то пошло не так, попробуйте позже');
            return response.send();
        }

        return databaseErrorHandler(err, response).send();
    }
});

// Оформление заказов
app.post('/offer', async (req, res) => {

    const response = new Response(res);
    const body = req.body;

    //проверка разрешения новых заказов
    if(!config.accept_new_offers){
        response.status(403, config.new_offers_limis_message);
        return response.send();
    }

    // Подписки заказы и т.д
    let offer_promo, offer_user, offer_id,offer_sub, paymentCalc;

    try{
        // Проверка на поля заказа
        checkOfferFields(body);

        // Поиск такой подписки
        offer_sub = await SUB.FIND([[{
            field: 'name_id',
            exacly: body.sub_id
        }]], true);

        // Поиск отметки на первый заказ
        offer_user = await USER.FIND([[{
            field: 'telegram_id',
            exacly: body.user_id
        }]], true);

        if(!offer_user){
            response.status(404, 'Пользователь не найден');
            return response.send();
        }

        if(!offer_sub){
            response.status(404, 'Подписка не найдена');
            return response.send();
        }

        // Проверка бесплатной подписки на первый заказ
        if(body.sub_id === 'free' && offer_user.free_trial_used){
            // Отказ пользователю в бесплатной подписке если заказ не первый
            response.status(403, 'Пробная подписка доступна только на первый заказ');
            return response.send();
        }

        // Если промокод не передан - применяется промокод по умолчанию
        if(!body.promo_id){
            offer_promo = await PROMO.FIND([[{
                field: 'name_id',
                exacly: 'default'
            }]], true);
        }
        else {
            //поиск промокода
            offer_promo = await PROMO.FIND([[{
                field: 'name_id',
                exacly: body.promo_id
            }]], true);

            // Проверка существования промокода
            if(!offer_promo){
                response.status(404, `Промокод '${body.promo_id}' не найден`);
                return response.send();
            }
        }

        // Cоздание нового заказа
        paymentCalc = await calcPriceAndDiscount(offer_user, offer_sub.price, offer_promo.discount);

        // Подмена промокода
        body.promo_id = offer_promo.name_id;

        // Время окончания подписки
        body.end_time = new Time().addTime(offer_sub.date_limit).shortUnix();

        // Создание нового заказа
        offer_id = await OFFER.NEW({...body, ...paymentCalc});

        // Создание деталей подписки
        const offerDetails = await createOfferDetails(offer_id, offer_sub, offer_promo, offer_user);

        // Проверка автооформление бесплатной подписки
        if(config.auto_accept_free_trial && body.sub_id === 'free'){
            //метод имеет внутрюю обработку ошибок и отправку запроса
            return await confirmOffer(offerDetails, response);
        }

        //оповещение о новом заказе для адинистратора
        await BotService.NOTIFY([{
            id: ADMIN_ID,
            message: `Новый заказ от: "${offerDetails._user.nickname}" 👤/n
            На подписку: "${offerDetails._sub.name_id}"/n
            Телеграм: @${offerDetails._user.telegram}/n/n
            К оплате: ${offerDetails.toPay} ₽
            `,
            control: {
                action: 'accept offer',
                offer_id
            }
        }]);

        // --- сценарий для платных подписок ---

        // Удаление скрытых полей
        Object.keys(offerDetails).forEach(key => {
            if(key.startsWith('_')) delete offerDetails[key];
        });

        // Отправка ответа
        response.body = offerDetails;

        // Отправка ответа
        response.status(201, 'Создано');
        response.send();

    }
    catch(err){
        //обработка ошибок телеграм сервиса
        if(err.response){
            //статус и сообщение телеграм сервиса
            const statusCode = err.response.statusCode;
            const message = err.response.data;

            WriteInLogFile(new Error(`Telegram service error on "Offer": ${statusCode} ${message}`));
            response.status(statusCode, 'Что-то пошло не так, попробуйте позже.');
            return response.send();
        }

        return databaseErrorHandler(err, response).send();
    }
});

// Получение информации о заказе
app.get('/offer', async (req, res) => {

    const response = new Response(res);
    const telegram_id = Number(req.query.telegram_id);

    // Проверка входных данных
    if(typeof telegram_id !== 'number' || isNaN(telegram_id)){
        response.status(417, 'Не передан telegram_id');
        return response.send();
    }

    try{
        // Получение последнего заказа
        const lastOffer = await OFFER.FIND([[{
            field: 'user_id',
            exacly: telegram_id
        }]], true, {byField: 'offer_id', decrease: true})

        // Проверка наличия действительных заявок
        if(!lastOffer || (!lastOffer.conn_string && lastOffer.sub_id === 'free')){
            response.status(404, 'Действительные заявки не найдены');
            return response.send();
        }

        // Получение информации о тарифе
        const offerSub = await SUB.FIND([[{
            field: 'name_id',
            exacly: lastOffer.sub_id
        }]], true);
        
        // Информация о подписке
        const waitingOffer = {
            offerId: lastOffer.offer_id,
            subName: offerSub.title,
            subDataGBLimit: offerSub.data_limit,
            subDateLimit: offerSub.date_limit
        };

        // Обработка зкаказа как "Ожидающий"
        if(!lastOffer.conn_string){
            response.body = waitingOffer;
            return response.send();
        }

        // Информация о пользователе
        const user = await USER.FIND([[{
            field: 'telegram_id',
            exacly: telegram_id
        }]], true);

        // Название пользователя
        const username = `${lastOffer.sub_id}_${lastOffer.offer_id}`;

        // Резервная подписка
        const def_sub_name = `${EncodeBase62BigInt(telegram_id)}-ДЛЯ-ТГ`;

        // Информация о заказе в системе Marzban
        const dataResult = await XUI_API.GetUser(username)
        const marzbanInfo = dataResult[0];

        // Проверка наличия информации
        if(!marzbanInfo){
            return response.status(404, 'Заявка в системе не найдена').send();
        }

        // Информация о резервной подписки для тг
        const defSubRes = await XUI_API.GetUser(def_sub_name);

        // Заказа может и не быть, так как это фича
        // В общем случае проверка не требовалась бы
        // Потом ее можно убрать, для ясности: defSubRes.length
        
        // Расчет оставшегося трафика
        const data_limit = !marzbanInfo.data_limit ? null : marzbanInfo.data_limit - marzbanInfo.used_traffic;

        //проверка окончания подписки и выставления флага об окончании
        const isExpired = (marzbanInfo.expire <= new Time().shortUnix() || (data_limit && data_limit <= 1024)) ? true : false;

        //скидка на следующую оплату
        const nextPayDiscVal = user.invite_count * config.invite_discount;

        //правка значения скидки
        const convPayDiscVal = nextPayDiscVal > 100 ? 100 : nextPayDiscVal;

        //разница лимита подписки и трафика пользователя
        const limitDiffrence = (marzbanInfo.data_limit - offerSub.data_limit * 1024**3) ? true : false;

        //формирование ответа
        response.body = {
            subName: offerSub.title,
            usedTraffic: marzbanInfo.used_traffic,
            dataLimit: marzbanInfo.data_limit,
            subDataGBLimit: offerSub.data_limit,
            subDateLimit: marzbanInfo.expire,
            createdDate: lastOffer.created_date,
            inviteCode: user.invite_code,
            userInviteCount: user.invite_count,
            nextPayDiscount: convPayDiscVal,
            price: offerSub.price,
            connString: marzbanInfo.connection_string,
            defConnString: defSubRes?.[0]?.connection_string,
            limitDiffrence,
            isExpired
        };

        response.send();

    }
    catch(err){
        // Сервер вернул ответ с ошибкой (например, 4xx или 5xx)
        if (err.response) {
            WriteInLogFile(new Error(`Marzban response on "Get Offer": 
            ${err.response.status} ${err.response.statusText}`.format()));
            response.status(500, 'Что-то пошло не так, попробуйте позже');
            return response.send();
        } 
        // Обработка ошибок базы данных
        else if(err.message && err.message.indexOf('SQLITE') !== -1){
            return databaseErrorHandler(err, response).send();
        }
        else {
            const errorMessage = err.message || 'Сервер Marzban не отвечает';
            WriteInLogFile(new Error(`Marzban sending response error on "Get Offer": ${errorMessage}`));
            response.status(500, 'Что-то пошло не так, попробуйте позже');
            return response.send();
        }
    }
});

// Одобрение заказа
app.patch('/confirm', async (req, res) => {

    const response = new Response(res);
    const {offer_id, status} = req.body;

    if(!offer_id){
        response.status(417, 'Не передан идентификатор заказа');
        return response.send();
    }

    try{
        // Информация о заказе
        const offerInfo = await OFFER.FIND([[{
            field: 'offer_id',
            exacly: offer_id
        }]], true);

        //если заказ был отклонен, то удалить
        if(status === 'rejected'){
            
            //удаление заявки
            await OFFER.DELETE(offer_id);

            //оповещение пользователя
            await BotService.NOTIFY([
            {
                id: ADMIN_ID,
                message: `Заявка №${offer_id} была отклонена ℹ️`,
            },{
                id: offerInfo.user_id,
                message: 'Ваша заявка была отклонена. Попробуйте создать новую 🔂'
            }]);

            response.status(200, 'Заявка отклонена');
            return response.send();
        }

        // Если такой заявки нет
        if(!offerInfo){
            response.status(404, `Заявка не найдена`);
            return response.send();
        }

        // Проверка на одобрение заказа ранее
        if(offerInfo.conn_string){
            response.status(409, 'Заявка уже одобрена');
            return response.send();
        }

        // Получение данных о заказе
        const offerDetails = await createOfferDetails(offerInfo);

        //для расчета скидки на первый заказ по инвайту, проверка на отсутствие до этого заказов (вкл бесплатную)
        offerDetails._paidOffer = await OFFER.FIND([[{
            field: 'user_id',
            exacly: offerDetails._user.telegram_id
        }, {
            field: 'conn_string',
            isNull: false
        }, {
            field: 'sub_id',
            nonEqual: 'free'
        }]], true);

        //поиск пользователя, что кинул приглашение
        if(offerDetails._user.invited_with_code){
            offerDetails._invitedBy = await USER.FIND([[{
                field: 'invite_code',
                exacly: offerDetails._user.invited_with_code
            }]], true);
        }

        // Метод имеет внутренюю обработку ошибок
        await confirmOffer(offerDetails, response);
    }
    catch(err){

        //обработка ошибок телеграм сервиса
        if(err.response){
            const statusCode = err.response.status;
            const errorMessage = err.response.data;

            WriteInLogFile(new Error(`Telegram response error on "Confirm Offer": ${statusCode} ${errorMessage}`));
            response.status(statusCode, 'Что-то пошло не так, попробуйте позже');
            return response.send();
        }

        return databaseErrorHandler(err, response).send();
    }
});

//изменение конфигурации
app.post('/config', async (req, res) => {
    const response = new Response(res);

    try {
        //проверка корректности полей конфигурации
        checkConfigFields(req.body);
        
        await fs.writeFile('./config.json', JSON.stringify(req.body, null, 2));

        //изменение конфигурации сервера
        config = req.body;
        response.send();
    }
    catch(err){

        //ошибка вызванная проверкой check
        if(err.dataCheck){
            return response.status(417, err.message).send();;
        }

        WriteInLogFile(err);

        // Ппроверяем, если ошибка возникла при проверке конфигурации
        if (err.message) {
            response.status(417).send(err.message);
        }
        else {
            response.status(500).send('Невозможно обновить конфигурацию');
        }
    }
});

//получение конфигурации
app.get('/config', (req, res) => {
    const response = new Response(res);
    response.body = config;
    response.send();
});

// Завершение работы сервера
app.post('/stop', (req, res) => {
    const response = new Response(res);

    // Отправка ответа
    response.send();

    // Закрытие сервера
    server.close(() => {
        WriteInLogFile('Server stopped');
        process.exit(0);
    });
})

//очистка логов 
app.patch('/logs', async (req, res) => {
    const response = new Response(res);

    try {
        await fs.writeFile('logs.txt', ''); // Очищаем файл логов
        response.status(200).send('ok');
    }
    catch (err) {
        WriteInLogFile(err);
        response.status(500).send('Невозможно почистить файл логов');
    }
});

//отправка логов
app.get('/logs', async (req, res) => {
    const response = new Response(res);

    try{
        const logs = await fs.readFile('logs.txt', 'utf-8');
        response.status(200).send(logs);
    }
    catch(err){
        WriteInLogFile(err);
        response.status(500).send('Невозможно отправить данные');
    }
});

// получение данных по фильтрам
app.get('/data', async (req, res) => {

    const response = new Response(res);

    // Параметры поиска
    let {tableName, condition, desc, telegram_id} = req.query;

    // Проверка входных данных
    if(!tableName){
        response.status(417, `Не передано название таблицы`);
        return response.send();
    }

    try{
        const dbData =  await db.find(tableName, condition, false, desc);
        if(dbData.length && tableName === 'sub' && telegram_id){
            for(let item of dbData){
                //получение пользователя
                const currentUser = await USER.FIND([[{
                    field: 'telegram_id',
                    exacly: telegram_id
                }]], true);

                const payInfo = await calcPriceAndDiscount(currentUser, item.price, 0);
                item.discount = payInfo.discount;
                item.price = payInfo.payment;
            }
        }

        response.body = dbData;
        response.send();

    }
    catch(err){
        return databaseErrorHandler(err, response).send();
    }
});

// Обновление данных
app.patch('/update', async (req, res) => {

    const response = new Response(res);

    // Проверка входных данных
    let {tableName, update, condition} = req.body;

    // Проверка входных данных
    if(!tableName){
        response.status(417, `Не передано название таблицы`);
        return response.send();
    }

    try{
        await db.update(tableName, update, condition);
        response.send();

    }
    catch(err){
        return databaseErrorHandler(err, response).send();
    }
})

// Пересоздание заявок (в случае сбоя или по иным причинам)
// УСТАНОВИТЬ В ДАЛЬНЕЙШЕМ ОГРАНИЧЕНИЕ НА ОБРАЩЕНИЕ РАЗ В 1 ДЕНЬ
app.patch('/recreate', async (req, res) => {

    const response = new Response(res);
    const {users, notify} = req.body;

    // Проверка входных данных
    if(!(users instanceof Array) || !users.length){
        response.status(417, `Пользователи для пересоздания не указаны`);
        return response.send();
    }

    const usersOffers = [];
    const dateTimeNow = new Time().shortUnix();

    try{
        // Получение последних заказов
        for(let i = 0; i < users.length; i++){

            const offerForUser = await OFFER.FIND([[{
                field: 'user_id',
                exacly: users[i]
            }, {
                field: 'end_time',
                more: dateTimeNow
            }]], true, {byField: 'offer_id', decrease: true})
            
            // Получение информации о заказе
            if(offerForUser && offerForUser.conn_string){
                const offerSub = await SUB.FIND([[{
                    field: 'name_id',
                    exacly: offerForUser.sub_id
                }]], true);

                offerForUser.data_limit = offerSub.data_limit;
                usersOffers.push(offerForUser);
            }
        }

        // Информировать об отсутстви действительных заявок для пользователей
        if(!usersOffers.length){
            response.status(404, 'Действительные заявки не найдены');
            return response.send();
        }

        //пересоздание заявок в Marzban
        for(let i = 0; i < usersOffers.length; i++){

            //название заявки: 'тариф_идентификатор'
            const username = `${usersOffers[i].sub_id}_${usersOffers[i].offer_id}`;

            // Информация о заказе в системе Marzban
            const dataResult = await XUI_API.GetUser(username)
            const userMarzbanData = dataResult[0];

            // Информировать об отсутстви действительных заявок
            if(!userMarzbanData){
                response.status(404, 'Заявка в системе не найдена');
                return response.send();
            }

            // Проверка истечения времени подписки
            if(userMarzbanData.expire <= new Time().shortUnix()){
                response.status(403, 'ℹ️ Срок по вашей подписки истек. Оформите новую в "Новая заявка"');
                return response.send();
            }

            //расчет оставшегося трафика
            const data_limit = !userMarzbanData.data_limit ? null : userMarzbanData.data_limit - userMarzbanData.used_traffic;

            //проверка истечения лимита
            if(data_limit && data_limit <= 1024){
                response.status(403, 'ℹ️ У вас закончился трафик по подписке. Оформите новую в "Новая заявка"');
                return response.send();
            }

            const expire = usersOffers[i].end_time;

            // Удаление действительной заявки
            await XUI_API.DeleteUser(username);

            // Создание новвой заявки с тем же именем
            const requestData = await XUI_API.CreateUser({email: username, totalGB: data_limit, expiryTime: expire * 1000});

            if(notify){
                // Тут уведомление о пересоздании заявки для пользователя
                await BotService.NOTIFY([
                    {
                        id: usersOffers[i].user_id,
                        message: `Ваш QR-код был автоматически обновлен системой ℹ️/n/n
                        Откройте опцию "Моя подписка", чтобы использовать.
                        `,
                        withDefaultOptions: true
                    }
                ]);
            }

            // Обновление строки подключения в заказе
            await OFFER.UPDATE(usersOffers[i].offer_id, {conn_string:  requestData.connection_string});
        }

        response.status(200, `Пересоздано заявок: ${usersOffers.length}`);
        response.send();

    }
    catch(err){
        // Сервер вернул ответ с ошибкой (например, 4xx или 5xx)
        if (err.response) {
            WriteInLogFile(new Error(`Marzban response Or telegram error on "Reacreate": 
            ${err.response.status} ${err.response.statusText}`.format()));
            response.status(500, 'Что-то пошло не так, попробуйте позже');
            return response.send();
        } 
        // Обработка ошибок базы данных
        else if(err.message && err.message.indexOf('SQLITE') !== -1){
            return databaseErrorHandler(err, response).send();
        }
        // Остальные ошибки
        else {
            const errorMessage = err.message || 'Сервер Marzban или Telegram не отвечает';
            WriteInLogFile(new Error(`Marzban sending or telegram response error on "Reacreate": ${errorMessage}`));
            response.status(500, 'Что-то пошло не так, попробуйте позже');
            return response.send();
        }
    }
});

// Удаление данных (Крайне не рекомендуется использовать)
app.delete('/delete', async (req, res) => {
    const response = new Response(res);

    // Проверка входных данных
    let {tableName, condition} = req.body;

    // Проверка входных данных
    if(!tableName){
        response.status(417, `Не передано название таблицы`);
        return response.send();
    }

    try{
        await db.delete(tableName, condition);
        response.send();

    }
    catch(err){
        return databaseErrorHandler(err, response).send();
    }
});

// Генерация ответа для заказа пользователя
async function createOfferDetails(offerOrId, sub, promo, user){

    let offerDbData, subDbData, promoDbData, userDbData;

    // Проверка поля offer
    if(typeof offerOrId === 'number'){
        offerDbData = await OFFER.FIND([[{
            field: 'offer_id',
            exacly: offerOrId
        }]], true);
    }
    
    // Страя добрая дедовская проверка
    if(!sub){
        subDbData = await SUB.FIND([[{
            field: 'name_id',
            exacly: offerOrId.sub_id
        }]], true);
    }
    
    // Страя добрая дедовская проверка
    if(!promo){
        promoDbData = await PROMO.FIND([[{
            field: 'name_id',
            exacly: offerOrId.promo_id
        }]], true);
    }
    
    // Страя добрая дедовская проверка
    if(!user){
        userDbData = await USER.FIND([[{
            field: 'telegram_id',
            exacly: offerOrId.user_id
        }]], true);
    }

    // Вобор данных
    const subData = subDbData || sub;
    const promoData = promoDbData || promo;
    const userData = userDbData || user;
    const offerData = offerDbData || offerOrId;

    // Информация для пользователя
    const offerDetails = {
        subname: subData.title,
        price: subData.price,
        toPay: offerData.payment,
        discount: offerData.discount,
        promoName: promoData.title,
        inviteCount: userData.invite_count,
        offerId: offerData.offer_id,
        _offer: offerData,
        _sub: subData,
        _user: userData
    }
    
    return offerDetails;
}

async function calcPriceAndDiscount(offer_user, subPrice, promoDiscount){

    //для расчета скидки на первый заказ по инвайту, проверка на отсутствие до этого заказов (вкл бесплатную)
    const paidOffer = await OFFER.FIND([[{
        field: 'user_id',
        exacly: offer_user.telegram_id
    }, {
        field: 'conn_string',
        isNull: false
    }, {
        field: 'sub_id',
        nonEqual: 'free'
    }]], true);

    let invited_by = null;

    //поиск пользователя, что кинул приглашение
    if(offer_user.invited_with_code){
        invited_by = await USER.FIND([[{
            field: 'invite_code',
            exacly: offer_user.invited_with_code
        }]], true);
    }

    // статичная скидка 25 % убарана
    // Отключена скидка по рефералка
    const discSum = (promoDiscount + config.invite_discount * offer_user.invite_count + ((!paidOffer && invited_by) ? config.for_invited_discount : 0)) / 100;
    const priceToPay = Math.ceil(subPrice * (1 - discSum));

    // Исключение отрицательной цены
    const payment = (priceToPay < 0) ? 0 : priceToPay;

    // Скидка
    const discount = (subPrice) ? Math.ceil((subPrice - payment) / subPrice * 100) : 0;
    return {payment, discount};
}

async function confirmOffer(offerInfo, response){

    try{
        // Уникальные имена для подписки
        const username = `${offerInfo._sub.name_id}_${offerInfo._offer.offer_id}`;

        // Установка даты окончания подписки
        const expire = offerInfo._offer.end_time;

        // Лимит данных
        const data_limit = offerInfo._sub.data_limit * 1024**3;

        // Выполняем запрос в обход методов работы с таблицей заказов
        const oldOffer = await OFFER.FIND([[{
            field: 'offer_id',
            less: offerInfo._offer.offer_id
        },{
            field: 'user_id',
            exacly: offerInfo._user.telegram_id
        },{
            field: 'conn_string',
            isNull: false
        }]], true, {
            byField: 'offer_id',
            decrease: true
        });

        // Если заказ найден, то удоляем его в системе Marzban
        if(oldOffer){
            const oldOfferName = `${oldOffer.sub_id}_${oldOffer.offer_id}`;

            // Удаление пользователя (С мягким исключением)
            await XUI_API.DeleteUser(oldOfferName);
            await OFFER.DELETE(oldOffer.offer_id);
        }

        // Создаем нового пользователя
        const requestData = await XUI_API.CreateUser({email: username, totalGB: data_limit, expiryTime: expire * 1000});

        // Установка текста подписки пользователя и отметка что был заказ
        await OFFER.UPDATE(offerInfo._offer.offer_id, {conn_string: requestData.connection_string});

        // Параметры для обновления пользователя
        let userUpdateOptions;
        
        // Если заказ был первый - отметить пользователя как использовавший бесплатную подписку
        if(!offerInfo._user.free_trial_used) userUpdateOptions = {free_trial_used: 1};

        // Сброс счетчика приглашенных для пользователя при новым заказе
        if(offerInfo._user.invite_count){
            userUpdateOptions = {...userUpdateOptions, invite_count: 0};
        }

        // Обновление пользователя
        if(userUpdateOptions) await USER.UPDATE(offerInfo._user.telegram_id, userUpdateOptions);

        let isUserHasEmptyDefCon = await USER.FIND([[{
            field: 'telegram_id',
            exacly: offerInfo._user.telegram_id
        },{
            field: 'default_con_string',
            isNull: true
        }]], true);

        // Создаем резервную вечную подписку
        if(isUserHasEmptyDefCon){

            const defSubGbLimit = 0.33;

            const shortTID = EncodeBase62BigInt(offerInfo._user.telegram_id);

            // Создаем нового пользователя
            const def_xui_sub = await XUI_API.CreateUser({
                email:  `${shortTID}-ДЛЯ-ТГ`,
                totalGB: defSubGbLimit * 1024**3,
                expiryTime: expire * 1000,
                reset: 25 //Сброс каждые 15 дней
            });

            await USER.UPDATE(offerInfo._user.telegram_id, {
                default_con_string: def_xui_sub.connection_string
            });
        }

        //уведомление для администратора
        const notifyUsers = [{
            id: ADMIN_ID,
            message: `Обработана заявка №${offerInfo._offer.offer_id} ℹ️/n/n
            👤 @${offerInfo._user.telegram} — "${offerInfo._user.nickname}"/n/n
            📶 Название тарифа: "${offerInfo._sub.title}."/n/n
            Ознакомиться подробнее можно в панели управления заявками
            `
        }]

        // Обновление зависимостей для платного заказа
        if(offerInfo._offer.sub_id !== 'free' && !offerInfo._paidOffer && offerInfo._invitedBy) {      
            await USER.INCREMENT_INVITE_COUNTER(offerInfo._invitedBy.telegram_id);

            //если пользователь был приглашен, кем-то уведомить о получении скидки
            notifyUsers.push({
                id: offerInfo._invitedBy.telegram_id,
                message: `<b>Пользователь @${offerInfo._user.nickname} оформил платный заказ 🔥</b>/n/n
                🪄 Вы получаете дополнительную скидку <b>${config.invite_discount}%</b>/n
                🤝 Всего приглашено друзей — <b>${offerInfo._invitedBy.invite_count + 1}</b>/n/n
                 <b><u>Ваша скидка доступна на следующий заказ 🎁</u></b>
                `
            });
        }

        // Если подписка бесплатная, убрать информацию о скидке и к оплате
        if(offerInfo._offer.sub_id === 'free'){
            delete offerInfo.discount;
            delete offerInfo.price;
            delete offerInfo.inviteCount;
        }
        //уведомлять пользователя только о платных подписках (бесплатные автоматически обрабатываются)
        else {
            notifyUsers.push({
                id: offerInfo._user.telegram_id,
                message: `Заявка <b>"${offerInfo._sub.title}"</b> подтверждена ✔️/n/nПерейдите в опцию <b>"Моя подписка"</b>, чтобы ознакомиться 👇`,
                withDefaultOptions: true
            });
        }
        
        //отправка уведомления
        await BotService.NOTIFY(notifyUsers)

        // Удаление скрытых полей
        Object.keys(offerInfo).forEach(key => {
            if(key.startsWith('_')) delete offerInfo[key];
        });

        // Отправка ответа
        response.status(200, 'Обновлено');
        response.body = {...offerInfo, connection: requestData.connection_string};

        return response.send();
    }
    catch(err){
        // Сервер вернул ответ с ошибкой (например, 4xx или 5xx)
        if (err.response) {
            const error = new Error(`Marzban OR telegram response on "Confirm": 
            ${err.response.status} ${err.response.statusText}`.format());
            WriteInLogFile(error);
            response.status(500, 'Что-то пошло не так, попробуйте позже');
            return response.send();
        } 
        //обработка ошибок базы данных
        else if(err.message && err.message.indexOf('SQLITE') !== -1){
            return databaseErrorHandler(err, response).send();
        }
        //остальные ошибки
        else {
            err.message = err.message || 'Сервер Marzban или Telegram в "Confirm" не отвечает';
            const error = new Error(err.message);
            WriteInLogFile(error);
            response.status(500, 'Что-то пошло не так, попробуйте позже');
            return response.send();
        }
    }
}

// Функция для подключения базы данных
async function initConnection(){ 
    try{
        await db.connect(`${DATABASE}.db`, 'init.sql');
    }
    catch(err){
        WriteInLogFile(err);
        throw err;
    }
}

function databaseErrorHandler(err, response){

    // Обработка ограничений
    if(err.message.indexOf('SQLITE_CONSTRAINT') !== -1){
        response.status(409, 'Что-то пошло не так, попробуйте позже');
    }
    // Обработка ошибок синтаксиса
    else if (err.message.indexOf('SQLITE_ERROR') !== -1){
        response.status(417, 'Что-то пошло не так, попробуйте позже');
    }
    // Обработка критических ошибок
    else {
        response.status(500, 'Что-то пошло не так, попробуйте позже');
    }

    WriteInLogFile(err);
    return response;
}

async function initTasks(){

    //Поддержка проекта (каждые 14 дней) 3600 * 1000 * 24 * дней
    TimeShedular.NewTask('notification', 1209600000, async () => {

        //получение всех пользователей для рассылки
        const users = await USER.FIND();

        const messageForUsers = users.map(user => {
            return {
                id : user.telegram_id,
                message: `<b>${user.nickname}, вы можете помочь проекту, сделав его лучше и дешевле 🤝</b>/n/n
                Разработчикам приходиться сопровождать проекты, поддерживать высокий сервис, чтобы сохранять ваше внимание и интерес. 
                Приобретая платную подписку и приглашая друзей, вы помогаете нам поддерживать наши проекты, и мотивируете создавать новые./n/n
                <b>Пригласите друзей по своей ссылке в "Моя подписка", и получите в знак нашей благодарности любую подписку в подарок 🎁</b>/n/n
                Вступайте также к нам в группу <a href="https://t.me/lightvpn_test">Kraken Team Project</a>, чтобы быть в курсе наших новостей и релизов./n/n
                <b>Ваша команда Kraken Team 🔱</b>`
            }
        })

        //уведомление пользователей об акции за приглашение
        if(messageForUsers.length){
            await BotService.NOTIFY(messageForUsers);
        }
    });

    //уведомление об окончании подписки (каждые 24 часов)
    TimeShedular.NewTask('offer ending', 86400000, async () => {

        //получение всех заказов для рассылки
        const offers = await OFFER.FIND([[
            {
                field: 'conn_string',
                isNull: false
            }
        ]]);

        //выбор заказов, у которых истекает подписка
        const untilTime = 432000, untilData = 3 * 1024**3, usersToNotify = [];

        for(let offer of offers){

            //текущее время
            const timeNow = new Time().shortUnix(); //2500000

            //если подписка полностью иссякла, прислать уведомление
            // if(timeNow >= offer.end_time){
            //     usersToNotify.push({
            //         id: offer.user_id,
            //         message: `Срок по вашей подписки подошел к концу. Офрмите новую, чтобы продолжить 🔂`
            //     });

            //     continue
            // }

            //если подписка заканчивается, прислать уведомление
            if(timeNow + untilTime >= offer.end_time){
                usersToNotify.push({
                    id: offer.user_id,
                    message: `Срок действия вашей подписки подходит к концу/n/n📅 ${new Time(offer.end_time).toFriendlyString()}/n/n
                    <b>Не забудьте оформить новую, перед ее окончанием 🔂/n/n
                    Резервная подписка в "Моя подписка" поможет вам с доступом телеграм в случае возникновения проблем, не теряйте ее.</b>
                    `
                })

                continue;
            }

            // Имя пользователя в Marzban
            const username = offer.sub_id + '_' + offer.offer_id;
                
            // Получение пользвоателя Marzban
            const dataResult = await XUI_API.GetUser(username);
            const marzbanUser = dataResult[0];

            if(!marzbanUser) continue;

            //расчет трафика
            const traffic_balance = !marzbanUser.data_limit ? null : marzbanUser.data_limit - marzbanUser.used_traffic;

            // Если трафик по подписке истек
            // if(traffic_balance && traffic_balance <= 1024){
            //     usersToNotify.push({
            //         id: offer.user_id,
            //         message: `Трафик по вашей подписке подошел к концу. Офрмите новую, чтобы продолжить 🔂/n/n
            //         Резервная подписка в "Моя подписка" поможет вам с доступом телеграм в случае возникновения проблем, не теряйте ее.</b>
            //         `
            //     })

            //     continue
            // }

            //если трафик по подписке подходит к концу
            if(marzbanUser.data_limit && traffic_balance <= untilData){
                usersToNotify.push({
                    id: offer.user_id,
                    message: `Трафик по вашей подписке подходит к концу/n/n
                    📶 Осталось: ${FormatBytes(traffic_balance)}/n/n
                    <b>Не забудьте оформить новую, перед окончанием 🔂</b>/n/n
                    Резервная подписка в "Моя подписка" поможет вам с доступом телеграм в случае возникновения проблем, не теряйте ее.</b>
                    `
                });

                continue;
            }
        }

        //уведомление пользователей об окончании подписки
        if(usersToNotify.length){
            await BotService.NOTIFY(usersToNotify);
        }
    });

    //уведомление о проблемах с подключением (каждую неделю)
    TimeShedular.NewTask('connection trouble', 604800000, async () => {

        //получение всех заказов с подключением
        const activeOffers = await OFFER.FIND([[{
            field : 'conn_string',
            isNull: false
        },{
            field : 'end_time',
            exaclyMore: new Time().shortUnix()
        }]]);

        const usersToNotify = [];

        //получение информации по трафику в Marzban и рассылка инструкции
        for(let i = 0; i < activeOffers.length; i++){

            //название подписки пользователя в Marzban
            const username = `${activeOffers[i].sub_id}_${activeOffers[i].offer_id}`;

            //получить информацию по трафику
            const dataResult = await XUI_API.GetUser(username);
            const userInMarzban = dataResult[0];

            if(!userInMarzban) continue;

            //проверка отсутствия трафика
            if(userInMarzban.used_traffic === 0){
                usersToNotify.push({
                    id: activeOffers[i].user_id,
                    control: {
                        action: 'instruction'
                    },
                    message: `
                        <b>❓ Мы заметили у вас рабочую подписку, к который вы так и не подключились</b>/n/n
                        Предлагаем вам просмотреть короткую видео-инструкцию, какое у вас устройство ?
                    `,
                    sticker: 'CAACAgIAAxkBAAILcmb3bNBeO9K9SoPnnzGVfXXrkexPAAIFDgAC7QOxStTbeV9QVl0HNgQ'
                })
            }
        }

        //рассылка рпиглашения на просмотр инструкции
        if(usersToNotify.length){
            await BotService.NOTIFY(usersToNotify);
        }
    });

    //уведомление о релакации в нидерланды (каждые 2 недели)
    TimeShedular.NewTask('releases', 864000000, async () => {
        const usersToNotify = await USER.FIND();
        const notifyMessages = usersToNotify.map(user => {
            return {
                id: user.telegram_id,
                withDefaultOptions: true,
                message: `
                    <b>Важная информация ⚡️⚡️⚡️</b>/n/n
                    <b>1. Доступ к некоторым сервисам</b>/n/n
                    🚫 Через VPN недоступны сайты и сервисы из белых списков РФ, для обеспечения вашей безопасности мы их заблокировали/n
                    ✔️ Чтобы ими воспользоваться — <b>просто отключите VPN</b>/n/n

                    <b>2. Крайне рекомендуем ⚡️</b>/n/n
                    📱 Отдельный телефон <b>без VPN</b> — для RU-сервисов: Сбер, Тинькофф, MAX, VK, Rutube и др./n/n

                    📱 Отдельный телефон <b>с VPN</b> — для всего остального:/n
                    TikTok, YouTube и др./n/n

                    ❗ <b>Важно:</b> никаких исключений — не смешивайте использование/n/n

                    <b>3. Резервные подписки 🆘</b>/n/n
                    ➕ Мы добавили резервные подписки для экстренного доступа к Telegram/n
                    🔄 Они обновляются каждый месяц и действуют бессрочно/n
                    ⚡️ Дают короткий доступ, чтобы оформить новую заявку и получить основную подписку/n/n

                    ❗ <b>Их нельзя терять</b>/n
                    ℹ️ Подробнее в разделе "Моя подписка"/n/n

                    <b>Наша рекомендация 💡</b>/n/n
                    ✔️ Следуйте этим правилам, чтобы сохранить стабильный доступ/n
                    ✔️ Это поможет оставаться на связи и спокойно пользоваться интернетом
                `
            }
        });

        //рассылка обновления
        await BotService.NOTIFY(notifyMessages);
    });
}

// const repairUsers = async () => {
//     //получение всех заказов с подключением
//     const activeOffers = await OFFER.FIND([[{
//         field : 'conn_string',
//         isNull: false
//     }]]);

//     for(let i = 0; i < activeOffers.length; i++){
//         const currentOffer = activeOffers[i];

//         if(currentOffer.end_time < new Time().shortUnix()){
//             continue;
//         }

//         const username = `${currentOffer.sub_id}_${currentOffer.offer_id}`;

//         const subData = await SUB.FIND([[{
//             field: 'name_id',
//             exacly: currentOffer.sub_id
//         }]], true);

//         const newUserData = {
//             email: username,
//             totalGB: subData.data_limit * 1024**3,
//             expiryTime: currentOffer.end_time * 1000
//         }

//         //создем подписку в системе
//         const dataResult = await XUI_API.CreateUser(newUserData);

//         console.log(`Восстановлен: ${username} 👏`);
//     }
// }



const repairUsers = async () => {
    //получение всех заказов с подключением
    const usersWithNotDefCon = await USER.FIND([[{
        field : 'default_con_string',
        isNull: true
    }]]);

    const offersWithConnections = await OFFER.FIND([[{
        field : 'conn_string',
        isNull: false
    }]]);

    const activeOffer = offersWithConnections.filter(offer => offer.end_time > new Time().shortUnix());

    for(let i = 0; i < usersWithNotDefCon.length; i++){

        const current = usersWithNotDefCon[i];

        if(!activeOffer.some(offer => offer.user_id == current.telegram_id)) {
            console.log(`Пропуск истекшего пользователя: ${current.nickname} ❌`);
            continue;
        }

        // if(currentOffer.end_time < new Time().shortUnix()){
        //     continue;
        // }

        // Создаем резервную вечную подписку
        const defSubGbLimit = 0.33;

        const shortTID = EncodeBase62BigInt(current.telegram_id);

        // Создаем нового пользователя
        const def_xui_sub = await XUI_API.CreateUser({
            email:  `${shortTID}-ДЛЯ-ТГ`,
            totalGB: defSubGbLimit * 1024**3,
            expiryTime: expire * 1000,
            reset: 25 //Сброс каждые 15 дней
        });

        await USER.UPDATE(current.telegram_id, {
            default_con_string: def_xui_sub.connection_string
        });

        console.log(`Добавлена строка по умолчанию пользователю: ${current.nickname} 👏`);
    }
}

// Запуск сервера на указанном порту
app.listen(PORT, '0.0.0.0', async () => {

    //очистка консоли
    console.clear();

    config = JSON.parse(await fs.readFile(new URL('./config.json', import.meta.url)));

    //инициализация XUI API
    await XUI_API.InitXrayConfig();

    try{
        await repairUsers();
        console.log('Подписки восстановлены 🎉');
    }
    catch(err){
        console.log('Не удалось восстановить все подписки 💥', err);
    }

    initTasks(); 
    WriteInLogFile(`Сервер прослушивается на http://localhost:${PORT} 👂`);
});