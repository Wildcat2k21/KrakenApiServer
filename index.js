const {USER, OFFER, SUB, PROMO} = require('./modules/Entities.js');
const MarzbanAPI = require('./modules/MarzbanAPI.js');
const Response = require('./modules/Response.js');
const Database = require('./modules/Database.js');
const express = require('express');
require('dotenv').config();
const fs = require('fs');

// Пользовательские модули
const Time = require('./modules/Time.js');
const {WriteInLogFile} = require('./modules/Other.js');
const {checkUserFields, checkOfferFields, checkConfigFields
} = require('./modules/Data.js');

// Конфигурация
let config = require('./config.json');

//основаная конфигурация
const PORT = process.env.PORT || 4015;
const DATABASE = process.env.DATABASE_NAME;

//экземпляр базы данных
const db = new Database(`${DATABASE}.db`);
const app = express();

// Инициализация базы данных
initConnection();

//примечание: Возможно if(err.response) || err.message никогда не выполнится с MarzbanAPI
//Было исправлено только в месте использования MarzbanAPI без запросов к сторонним сервисам
//потенциально имеются места для push уведомлений сервиса телеграм

// Инициализация сущностей
const user = new USER(db);
const offer = new OFFER(db);
const sub = new SUB(db);
const promo = new PROMO(db);

// Middleware для парсинга JSON-тел
app.use(express.json());

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

        response.status(201, 'Создано')
        response.send();
    }
    catch(err){

        // Ошибки формата данных для пользователя
        if(err.dataCheck){
            response.status(417, err.message);
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
    let offer_promo, offer_user, offer_id,offer_sub, invited_by, paymentCalc;

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
            // Проверка на пользовательский промокод
            invited_by = await USER.FIND([[{
                field: 'invite_code',
                exacly: body.promo_id
            }]], true);

            // Проверка, что пользователь был приглашен
            if(invited_by){
                offer_promo = await PROMO.FIND([[{
                    field: 'name_id',
                    exacly: 'friend'
                }]], true);

                body.invite_code = body.promo_id;

            }
            // Игнорировать скрытый промокод
            else if(body.promo_id !== 'friend'){
                offer_promo = await PROMO.FIND([[{
                    field: 'name_id',
                    exacly: body.promo_id
                }]], true);
            }
            else {}

            // Проверка существования промокода
            if(!offer_promo){
                response.status(404, `Промокод '${body.promo_id}' не найден`);
                return response.send();
            }
        }

        // Подмена промокода
        body.promo_id = offer_promo.name_id;

        // Время окончания подписки
        body.end_time = new Time().addTime(offer_sub.date_limit).shortUnix();

        // создание нового заказа
        paymentCalc = calcPriceAndDiscount(offer_sub.price, offer_user.invite_count, offer_promo.discount);

        // Создание нового заказа
        offer_id = await OFFER.NEW({...body, ...paymentCalc});

        // Создание деталей подписки
        const offerDetails = await createOfferDetails(offer_id, offer_sub, offer_promo, offer_user, invited_by, paymentCalc);

        // Проверка автооформление бесплатной подписки
        if(config.auto_accept_free_trial && body.sub_id === 'free'){
            //метод имеет внутрюю обработку ошибок и отправку запроса
            return await confirmOffer(offerDetails, response);
        }

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
            response.status(404, 'Нет действительных заявок');
            return response.send();
        }

        // Получение информации о тарифе
        const offerSub = await SUB.FIND([[{
            field: 'name_id',
            exacly: lastOffer.sub_id
        }]], true);
        
        // Информация о подписке
        const offerUser = {
            subName: offerSub.title,
            subDataGBLimit: offerSub.data_limit / 1024**3,
            subDateLimit: offerSub.date_limit
        };

        // Обработка зкаказа как "Ожидающий"
        if(!lastOffer.conn_string){
            response.body = offerUser;
            return response.send();
        }

        // Информация о пользователе
        const user = await USER.FIND([[{
            field: 'telegram_id',
            exacly: telegram_id
        }]], true);

        // Название пользователя
        const username = `${lastOffer.sub_id}_${lastOffer.offer_id}`;

        // Информация о заказе в системе Marzban
        const marzbanInfo = await MarzbanAPI.GET_USER(username);

        // Формирование ответа
        response.body = {
            ...offerUser,
            usedTraffic: marzbanInfo.used_traffic,
            subDateLimit: new Time(marzbanInfo.expire).fromUnix(true),
            createdDate: new Time(lastOffer.create_date).fromUnix(true),
            inviteCode: user.invite_code,
            price: offerSub.price,
            connString: marzbanInfo.links[0]
        };

        response.send();

    }
    catch(err){
        // Сервер вернул ответ с ошибкой (например, 4xx или 5xx)
        if (err.response) {
            const statusCode = err.response.status;
            const errorMessage = err.response.data.detail;
            WriteInLogFile(new Error(`Marzban response: ${statusCode} ${errorMessage}`));
            response.status(statusCode, 'Что-то пошло не так, попробуйте позже');
            return response.send();
        } 
        // Обработка ошибок базы данных
        else if(err.message && err.message.indexOf('SQLITE') !== -1){
            return databaseErrorHandler(err, response).send();
        }
        else {
            err.message = err.message || 'Сервер Marzban не отвечает';
            WriteInLogFile(new Error(`Marzban sending response error: ${err.message}`));
            response.status(500, 'Что-то пошло не так, попробуйте позже');
            return response.send();
        }
    }
});

// Одобрение заказа
app.patch('/confirm', async (req, res) => {

    const response = new Response(res);
    const offer_id = req.body.offer_id;

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

        // Метод имеет внутренюю обработку ошибок
        await confirmOffer(offerDetails, response);

    }catch(err){
        return databaseErrorHandler(err, response).send();
    }
});

// Изменение конфигурации API server
app.post('/configure', (req, res) => {

    const response = new Response(res, 200, 'modified');

    try{
        checkConfigFields(req.body);
    }
    catch(err){
        response.status(417, err.message);
        return response.send();
    }

    // Изменение файла конфигурации
    fs.writeFile('./config.json', JSON.stringify(req.body, null, 2), (err) => {
        if (err) {
            WriteInLogFile(err);
            response.status(500, 'Что-то пошло не так, попробуйте позже');
        };
    });

    // Изменение конфигурации сервера
    response.body = config = req.body;
    response.send();
});

//получение конфигурации
app.get('/config', (req, res) => {
    const response = new Response(res);
    response.body = config;
    response.send();
});

//получение логов
app.get('/logs', async (req, res) => {

    const response = new Response(res);

    try{
        response.body = await fs.readFileSync('logs.txt', 'utf8');
        response.send();
    }
    catch(err){
        WriteInLogFile(err);
        response.status(500, 'Что-то пошло не так, попробуйте позже');
        response.send();
    }
});

// получение данных по фильтрам
app.get('/data', async (req, res) => {

    const response = new Response(res);

    // Параметры поиска
    let {tableName, condition, desc} = req.query;

    // Проверка входных данных
    if(!tableName){
        response.status(417, `Не передано название таблицы`);
        return response.send();
    }

    try{
        response.body = await db.find(tableName, condition, false, desc);
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

    // Проверка входных данных
    if(typeof update !== 'object' || !Object.keys(update).length){
        response.status(417, `Не переданы данные для обновления`);
        return response.send();
    }

    // Проверка входных данных
    if(typeof condition !== 'object' || !Object.keys(condition).length){
        response.status(417, `Не переданы условия обновления`);
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
    const users = req.body.users;

    // Проверка входных данных
    if(!users || !users instanceof Array || !users.length){
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
            response.status(404, 'Нет действительных заявок');
            return response.send();
        }

        //пересоздание заявок в Marzban
        for(let i = 0; i < usersOffers.length; i++){

            //название заявки: 'тариф_идентификатор'
            const username = `${usersOffers[i].sub_id}_${usersOffers[i].offer_id}`;
            const expire = usersOffers[i].end_time;
            const data_limit = usersOffers[i].data_limit;

            //удаление действительной заявки
            await MarzbanAPI.DELETE_USER(username);

            //тут генерируем строку подключения и передаем ее пользователю
            const userData = {
                status: 'active',
                username, //имя тарифа
                note: 'by API server', //примечание
                proxies: {
                    vless: {
                        flow: 'xtls-rprx-vision'
                    }
                },
                data_limit, //ГБ * 1024**3  
                expire, //Unix-время в секундах работы тарифа
                data_limit_reset_strategy: 'no_reset',
                inbounds: {
                    vmess: ['VMess TCP', 'VMess Websocket'],
                    vless: ['VLESS TCP REALITY'],
                    trojan: ['Trojan Websocket TLS'],
                    shadowsocks: ['Shadowsocks TCP']
                }
            };

            //создание новвой заявки с тем же именем
            const requestData = await MarzbanAPI.CREATE_USER(userData);

            //тут уведомление о пересоздании заявки для пользователя
            
            //обновление строки подключения в заказе
            await OFFER.UPDATE(usersOffers[i].offer_id, {conn_string:  requestData.links[0]});
        }

        response.status(200, `Пересоздано заявок: ${usersOffers.length}`);
        response.send();

    }
    catch(err){
        // Сервер вернул ответ с ошибкой (например, 4xx или 5xx)
        if (err.response) {
            const statusCode = err.response.status;
            const errorMessage = err.response.data.detail;
            WriteInLogFile(new Error(`Marzban response: ${statusCode} ${errorMessage}`));
            response.status(statusCode, 'Что-то пошло не так, попробуйте позже');
            return response.send();
        } 
        // Обработка ошибок базы данных
        else if(err.message && err.message.indexOf('SQLITE') !== -1){
            return databaseErrorHandler(err, response).send();
        }
        // Остальные ошибки
        else {
            err.message = err.message || 'Сервер Marzban не отвечает';
            WriteInLogFile(new Error(`Marzban sending response error: ${err.message}`));
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

    // Проверка входных данных
    if(typeof condition !== 'object' || !Object.keys(condition).length){
        response.status(417, `Не переданы условия удаления`);
        return response.send();
    }

    try{
        await db.delete(tableName, condition);
        response.send();

    }catch(err){
        return databaseErrorHandler(err, response).send();
    }
});

// Генерация ответа для заказа пользователя
async function createOfferDetails(offerOrId, sub, promo, user, invited, paymentCalc){

    let offerDbData, subDbData, promoDbData, userDbData, invitedDbData;

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
    const subData = sub || subDbData;
    const promoData = promo || promoDbData;
    const userData = user || userDbData;
    const invitedData = invited || invitedDbData;
    const offerData = offerDbData || offerOrId;

    // Расчет цены и скидки
    const {payment, discount} = paymentCalc || calcPriceAndDiscount(subData.price, userData.invite_count, promoData.discount);

    // Информация для пользователя
    const offerDetails = {
        subname: subData.title,
        price: subData.price,
        toPay: payment,
        discount,
        promoName: promoData.title,
        inviteCount: userData.invite_count,
        _offer: offerData,
        _sub: subData,
        _user: userData,
        _invitedBy: invitedData
    }
    
    return offerDetails;
}

function calcPriceAndDiscount(subPrice, invteCount, promoDiscount){
        
    // Скидки на оформление
    const promoPrice = subPrice * (1 - promoDiscount/100);
    const invitPrice = promoPrice * (1 - config.invite_discount/100 * invteCount);
    const priceToPay = Math.ceil(invitPrice);

    // Исключение отрицательной цены
    const payment = (priceToPay < 0) ? 0 : priceToPay;

    // Скидка
    const discount = (subPrice) ? Math.ceil((subPrice - payment) / subPrice * 100) : 0;
    return {payment, discount};
}

async function confirmOffer(offerInfo, response){

    try{
        // Уникальный имена для тарифа
        const username = `${offerInfo._sub.name_id}_${offerInfo._offer.offer_id}`;

        // Установка даты окончания подписки
        const expire = offerInfo._offer.end_time;

        // Лимит данных
        const data_limit = offerInfo._sub.data_limit * 1024**3;

        // Тут генерируем строку подключения и передаем ее пользователю
        const userData = {
            status: 'active',
            username, //имя тарифа
            note: 'by API server', //примечание
            proxies: {
                vless: {
                    flow: 'xtls-rprx-vision'
                }
            },
            data_limit, //ГБ * 1024**3  
            expire, //Unix-время в секундах работы тарифа
            data_limit_reset_strategy: 'no_reset',
            inbounds: {
                vmess: ['VMess TCP', 'VMess Websocket'],
                vless: ['VLESS TCP REALITY'],
                trojan: ['Trojan Websocket TLS'],
                shadowsocks: ['Shadowsocks TCP']
            }
        };

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
            await MarzbanAPI.DELETE_USER(oldOfferName);
            await OFFER.UPDATE(oldOffer.offer_id, {conn_string: null});
        }

        // Создаем нового пользователя
        const requestData = await MarzbanAPI.CREATE_USER(userData);

        // Установка текста подписки пользователя и отметка что был заказ
        await OFFER.UPDATE(offerInfo._offer.offer_id, {conn_string: requestData.links[0]});
        
        // Параметры для обновления пользователя
        let userUpdateOptions;
        
        // Если заказ был первый - отметить пользователя как использовавший бесплатную подписку
        if(!offerInfo._user.free_trial_used) userUpdateOptions = {free_trial_used: 1};

        // Сброс счетчика приглашенных для пользователя при новым заказе
        if(offerInfo._user.invite_count){
            userUpdateOptions = {...userUpdateOptions, invite_count: 0};
        }
        
        // Обновление зависимостей для платного заказа
        if(offerInfo._offer.sub_id !== 'free' && offerInfo._offer.promo_id === 'friend' && offerInfo._offer.invite_code) {
            
            //поиск пользователя с таким промокодом
            const invitePromoCodeOwner = offerInfo._invitedBy || await USER.FIND([[{
                field: 'invite_code',
                exacly: offerInfo._offer.invite_code
            }]], true);
            
            await USER.INCREMENT_INVITE_COUNTER(invitePromoCodeOwner.telegram_id);
        }

        // Обновление пользователя
        if(userUpdateOptions) await USER.UPDATE(offerInfo._offer.user_id, userUpdateOptions);

        // Если подписка бесплатная, убрать информацию о скидке и к оплате
        if(offerInfo._offer.sub_id === 'free'){
            delete offerInfo.discount;
            delete offerInfo.price;
            delete offerInfo.inviteCount;
        }

        // Удаление скрытых полей
        Object.keys(offerInfo).forEach(key => {
            if(key.startsWith('_')) delete offerInfo[key];
        });

        // Тут уведомление о новой заявке (бесплатная платная для администратора)
        // И уведомление пользователя о одобрении заявки (бесплатная одобряется сразу)

        // Отправка ответа
        response.status(200, 'Обновлено');
        response.body = {...offerInfo, connection: requestData.links[0]};
        return response.send();
    }
    catch(err){
        // Сервер вернул ответ с ошибкой (например, 4xx или 5xx)
        if (err.response) {
            const statusCode = err.response.status;
            const errorMessage = err.message || err.response.data.detail;
            const error = new Error(`Marzban response: ${statusCode} ${errorMessage}`);
            WriteInLogFile(error);
            response.status(statusCode, 'Что-то пошло не так, попробуйте позже');
            return response.send();
        } 
        //обработка ошибок базы данных
        else if(err.message && err.message.indexOf('SQLITE') !== -1){
            return databaseErrorHandler(err, response).send();
        }
        //остальные ошибки
        else {
            err.message = err.message || 'Сервер Marzban не отвечает';
            const error = new Error(`Marzban sending response error: ${err.message}`);
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

// Запуск сервера на указанном порту
app.listen(PORT, '0.0.0.0', async () => {
    console.clear();
    WriteInLogFile(`Сервер прослушивается на http://localhost:${PORT} 👂`);
});