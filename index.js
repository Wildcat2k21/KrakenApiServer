const {USER, OFFER, SUB, PROMO} = require('./modules/Entities.js');
const MarzbanAPI = require('./modules/MarzbanAPI.js');
const Response = require('./modules/Response.js');
const Database = require('./modules/Database.js');
const express = require('express');
require('dotenv').config();
const fs = require('fs');

//пользовательские модули
const {Time, WriteInLogFile} = require('./modules/Other.js');
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

    // Проверка количества пользователей
    try{
        const totalParticipants = await USER.COUNT();
        if(totalParticipants >= config.total_participants_limit){
            response.status(403, 'Достигнут лимит пользователей');
            return response.send();
        }
    }
    catch(err){
        return databaseErrorHandler(err, response).send();
    }

    // Проверка на поля пользователя
    try{
        checkUserFields(body);
    }
    // 417 статус для ошибок ввода
    catch(err){
        response.status(417, err.message);
        return response.send();
    }

    // Выполнение опреации вставки
    try{
        await USER.NEW(body);
        response.status(201, 'Создано')
        return response.send();
    }
    catch(err){
        return databaseErrorHandler(err, response).send();
    }
});

// Оформление заказов
app.post('/offer', async (req, res) => {

    const response = new Response(res);

    //проверка разрешения новых заказов
    if(!config.accept_new_offers){
        response.status(403, config.new_offers_limis_message);
        return response.send();
    }

    const body = req.body;
    
    //идентификатор заказа
    let offer_promo, offer_user, offer_id, offer_sub, invited_by, paymentCalc;

    // Проверка на поля заказа
    try{
        checkOfferFields(body);
    }
    catch(err){
        response.status(417, err.message);
        return response.send();
    }

    // Добавление нового заказа
    try{

        //поиск такой подписки
        offer_sub = await SUB.FIND({name_id: body.sub_id}, true);

        //поиск отметки на первый заказ
        offer_user = await USER.FIND({telegram_id: body.user_id}, true);

        if(!offer_user){
            response.status(404, 'Пользователь не найден');
            return response.send();
        }

        if(!offer_sub){
            response.status(404, 'Подписка не найдена');
            return response.send();
        }

        //проверка бесплатной подписки на первый заказ
        if(body.sub_id === 'free' && offer_user.free_trial_used){
            //отказ пользователю в бесплатной подписке если заказ не первый
            response.status(403, 'Пробная подписка доступна только на первый заказ');
            return response.send();
        }

        //если промокод не передан - применяется промокод по умолчанию
        if(!body.promo_id){
            offer_promo = await PROMO.FIND({name_id: 'default'}, true);
        }
        else {
            //проверка на пользовательский промокод
            invited_by = await USER.FIND({invite_code: body.promo_id}, true);

            //выставление промокодов
            if(invited_by){
                offer_promo = await PROMO.FIND({name_id: 'friend'}, true);
                //вынесение кода приглашения в отдельное поле
                body.invite_code = body.promo_id;
            }
            else if(body.promo_id !== 'friend'){
                offer_promo = await PROMO.FIND({name_id: body.promo_id}, true);
            }
            else {}

            //проверка существования промокода
            if(!offer_promo){
                response.status(404, `Промокод '${body.promo_id}' не найден`);
                return response.send();
            }
        }

        //подмена промокода
        body.promo_id = offer_promo.name_id;

        //время окончания подписки
        body.end_time = new Time().addTime(offer_sub.date_limit).shortUnix();

        //создание нового заказа
        paymentCalc = calcPriceAndDiscount(offer_sub.price, offer_user.invite_count, offer_promo.discount);

        //установление порядкового номера заказа пользователя
        // const priviousUserOffer = await OFFER.FIND({user_id: offer_user.user_id, user_offer_id}, true);

        //создание нового заказа
        offer_id = await OFFER.NEW({...body, ...paymentCalc});
        response.status(201, 'Создано');
    }
    catch(err){
        return databaseErrorHandler(err, response).send();
    }

    //обрабатываем тип подписки
    try{
        //создание деталей подписки
        const offerDetails = await createOfferDetails(offer_id, offer_sub, offer_promo, offer_user, invited_by, paymentCalc);

        //проверка автооформление бесплатной подписки
        if(config.auto_accept_free_trial && body.sub_id === 'free'){
            //метод имеет внутрюю обработку ошибок и отправку запроса
            return await confirmOffer(offerDetails, response);
        }

        // --- сценарий для платных подписок ---

        //удаление скрытых полей
        Object.keys(offerDetails).forEach(key => {
            if(key.startsWith('_')) delete offerDetails[key];
        });

        //отправка ответа
        response.body = offerDetails;

        //отправка ответа
        response.send();

    }catch(err){
        return databaseErrorHandler(err, response).send();
    }
});

//получение информации о заказе
app.get('/offer', async (req, res) => {
    const response = new Response(res);
    const telegram_id = Number(req.query.telegram_id);

    //проверка входных данных
    if(typeof telegram_id !== 'number' && !isNaN(telegram_id)){
        response.status(417, 'Не передан telegram_id');
        return response.send();
    }

    //получение информации о заказе
    try{
        const offerSql = `SELECT * FROM offer WHERE user_id = ${users[i]} ORDER BY offer_id DESC LIMIT 1`;
        const lastOffer = await db.executeWithReturning(offerSql);
        
        //информировать об отсутстви действительных заявок для пользователей
        if(!lastOffer.length) {
            response.status(404, 'Нет действительных заявок');
            return response.send();
        }

        //информация о пользователе
        const user = await USER.FIND({telegram_id}, true);

        //получение информации о тарифе
        const offerSub = await SUB.FIND({sub_id: lastOffer[0].sub_id}, true);

        //название пользователя
        const username = `${lastOffer[0].sub_id}_${lastOffer[0].offer_id}`;

        //информация о заказе в системе Marzban
        const marzbanInfo = await MarzbanAPI.GET_USER(username); 

        //формирование ответа
        const offerInfo = {
            subName: offerSub.title,
            subDataGBLimit: offerSub.data_limit,
            usedGBtraffic: marzbanInfo.used_traffic / 1024**3,
            subDateLimit: new Time(offerSub.date_limit).fromUnix(true),
            createdDate: new Time(lastOffer[0].create_date).fromUnix(true),
            inviteCode: user.invite_code,
            connString: marzbanInfo.conn_string
        }

        //ответ
        response.body = offerInfo;
        response.send();

    }catch(err){
        // Сервер вернул ответ с ошибкой (например, 4xx или 5xx)
        if (err.response) {
            const statusCode = err.response.status;
            const errorMessage = err.response.data.detail;

            //вывод ошибки в консоль
            WriteInLogFile(new Error(`Marzban response: ${statusCode} ${errorMessage}`));

            response.status(statusCode, 'Что-то пошло не так, попробуйте позже');
            return response.send();
        } 
        //обработка ошибок базы данных
        else if(err.message && err.message.indexOf('SQLITE') !== -1){
            return databaseErrorHandler(err, response).send();

        }
        //остальные ошибки
        else {
            // Запрос был сделан, но ответа от сервера не было
            err.message = err.message || 'Сервер Marzban не отвечает';

            //вывод ошибки в консоль
            WriteInLogFile(new Error(`Marzban sending response error: ${err.message}`));

            response.status(500, 'Что-то пошло не так, попробуйте позже');
            return response.send();
        }
    }
});

//одобрение заказа
app.patch('/confirm', async (req, res) => {
    const response = new Response(res);
    const offer_id = req.body.offer_id;

    if(!offer_id){
        response.status(417, 'Не передан идентификатор заказа');
        return response.send();
    }

    try{
        //информация о заказе
        const offerInfo = await OFFER.FIND({offer_id}, true);

        //если такой заявки нет
        if(!offerInfo){
            response.status(404, `Заявка не найдена`);
            return response.send();
        }

        //проверка на одобрение заказа ранее
        if(offerInfo.conn_string){
            response.status(409, 'Заявка уже одобрена');
            return response.send();
        }

        //получение данных о заказе
        const offerDetails = await createOfferDetails(offerInfo);

        //метод имеет внутренюю обработку ошибок
        await confirmOffer(offerDetails, response);

    }catch(err){
        return databaseErrorHandler(err, response).send();
    }
});

// Изменение конфигурации API server
app.post('/configure', (req, res) => {

    const response = new Response(res, 200, 'modified');

    // Проверка корректности конфигурации
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

    //reading logs and send
    try{
        response.body = await fs.readFileSync('logs.txt', 'utf8');
    }
    catch(err){
        WriteInLogFile(err);
        response.status(500, 'Что-то пошло не так, попробуйте позже');
    }

    response.send();
});

//получение данных по фильтрам
app.get('/data', async (req, res) => {

    const response = new Response(res);

    //параметры поиска
    let {tableName, filters, limit} = req.query;

    //проверка входных данных
    if(!tableName){
        response.status(417, `Не передано название таблицы`);
        return response.send();
    }

    //проверка входных данных
    if(filters === undefined || filters === null){
        filters = {};
    }

    //поиск данных по параметрам
    try{
        const data = await db.find(tableName, filters, limit);
        response.body = data;
        response.send();

    }
    catch(err){
        return databaseErrorHandler(err, response).send();
    }
});

//обновление данных
app.patch('/update', async (req, res) => {

    const response = new Response(res);

    //проверка входных данных
    let {tableName, update, condition} = req.body;

    //проверка входных данных
    if(!tableName){
        response.status(417, `Не передано название таблицы`);
        return response.send();
    }

    //проверка входных данных
    if(typeof update !== 'object' || !Object.keys(update).length){
        response.status(417, `Не переданы данные для обновления`);
        return response.send();
    }

    //проверка входных данных
    if(typeof condition !== 'object' || !Object.keys(condition).length){
        response.status(417, `Не переданы условия обновления`);
        return response.send();
    }

    //обновлене данных по параметрам
    try{
        await db.update(tableName, update, condition);
        response.send();

    }
    catch(err){
        return databaseErrorHandler(err, response).send();
    }
})

//пересоздание заявок (в случае сбоя или по иным причинам)
//УСТАНОВИТЬ В ДАЛЬНЕЙШЕМ ОГРАНИЧЕНИЕ НА ОБРАЩЕНИЕ РАЗ В 1 ДЕНЬ
app.patch('/recreate', async (req, res) => {

    const response = new Response(res);
    const users = req.body.users;

    //проверка входных данных
    if(!users || !users instanceof Array || !users.length){
        response.status(417, `Пользователи для пересоздания не указаны`);
        return response.send();
    }

    const usersOffers = [];
    const dateTimeNow = new Time().shortUnix();

    //поиск заказов
    try{
        //получение последних заказов
        for(let i = 0; i < users.length; i++){
            const allSelectedUsersSql = `
                SELECT * FROM offer
                    WHERE
                    user_id = ${users[i]}
                    AND end_time > ${dateTimeNow}
                    AND conn_string IS NOT NULL
                ORDER BY offer_id DESC
                LIMIT 1
            `;

            const offerForUser = await db.executeWithReturning(allSelectedUsersSql);
            
            //получение информации о заказе
            if(offerForUser.length){
                const offerSub = await SUB.FIND({name_id: offerForUser[0].sub_id}, true);
                offerForUser[0].data_limit = offerSub.data_limit;
                usersOffers.push(offerForUser[0]);
            }
        }

        //информировать об отсутстви действительных заявок для пользователей
        if(!usersOffers.length){
            response.status(404, 'Нет действительных заявок');
            return response.send();
        }

    }catch(err){
        return databaseErrorHandler(err, response).send();
    }

    //удаление старых заявок и создание новых
    try{
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
        
    }catch(err){
        // Сервер вернул ответ с ошибкой (например, 4xx или 5xx)
        if (err.response) {
            const statusCode = err.response.status;
            const errorMessage = err.response.data.detail;

            //вывод ошибки в консоль
            WriteInLogFile(new Error(`Marzban response: ${statusCode} ${errorMessage}`));

            response.status(statusCode, 'Что-то пошло не так, попробуйте позже');
            return response.send();
        } 
        //обработка ошибок базы данных
        else if(err.message && err.message.indexOf('SQLITE') !== -1){
            return databaseErrorHandler(err, response).send();

        }
        //остальные ошибки
        else {
            // Запрос был сделан, но ответа от сервера не было
            err.message = err.message || 'Сервер Marzban не отвечает';

            //вывод ошибки в консоль
            WriteInLogFile(new Error(`Marzban sending response error: ${err.message}`));

            response.status(500, 'Что-то пошло не так, попробуйте позже');
            return response.send();
        }
    }
});

//Удаление данных (Крайне не рекомендуется использовать)
app.delete('/delete', async (req, res) => {
    const response = new Response(res);

    //проверка входных данных
    let {tableName, condition} = req.body;

    //проверка входных данных
    if(!tableName){
        response.status(417, `Не передано название таблицы`);
        return response.send();
    }

    //проверка входных данных
    if(typeof condition !== 'object' || !Object.keys(condition).length){
        response.status(417, `Не переданы условия удаления`);
        return response.send();
    }

    //удаление данных по параметрам
    try{
        await db.delete(tableName, condition);
        response.send();

    }catch(err){
        return databaseErrorHandler(err, response).send();
    }
});

//генерация ответа для заказа пользователя
async function createOfferDetails(offerOrId, sub, promo, user, invited, paymentCalc){

    //проверка поля offer
    if(typeof offerOrId === 'number'){
        offerOrId = await OFFER.FIND({offer_id: offerOrId}, true);
    }

    //страя добрая дедовская проверка
    if(!sub){
        sub = await SUB.FIND({name_id: offerOrId.sub_id}, true);
    }
    //страя добрая дедовская проверка
    if(!promo){
        promo = await PROMO.FIND({name_id: offerOrId.promo_id}, true);
    }
    //страя добрая дедовская проверка
    if(!user){
        user = await USER.FIND({telegram_id: offerOrId.user_id}, true);
    }

    //расчет цены и скидки
    const {payment, discount} = paymentCalc || calcPriceAndDiscount(sub.price, user.invite_count, promo.discount);

    //информация для пользователя
    const offerDetails = {
        subname: sub.title,
        price: sub.price,
        toPay: payment,
        discount,
        promoName: promo.title,
        inviteCount: user.invite_count,
        _offer: offerOrId,
        _sub: sub,
        _user: user,
        _invitedBy: invited
    }
    
    return offerDetails;
}

function calcPriceAndDiscount(subPrice, invteCount, promoDiscount){
        
    //скидки на оформление
    const promoPrice = subPrice * (1 - promoDiscount/100);
    const invitPrice = promoPrice * (1 - config.invite_discount/100 * invteCount);
    const priceToPay = Math.ceil(invitPrice);

    //исключение отрицательной цены
    const payment = (priceToPay < 0) ? 0 : priceToPay;

    //скидка
    const discount = (subPrice) ? Math.ceil((subPrice - payment) / subPrice * 100) : 0;
    return {payment, discount};
}

async function confirmOffer(offerInfo, response){

    //отметка одобрения заказа
    try{
        //уникальный имена для тарифа
        const username = `${offerInfo._sub.name_id}_${offerInfo._offer.offer_id}`;

        //установка даты окончания подписки
        const expire = offerInfo._offer.end_time;

        //лимит данных
        const data_limit = offerInfo._sub.data_limit * 1024**3;

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

        //ищем предыдущий заказ со строкой подключения
        const oldOfferSqlQuery = `
            SELECT * FROM offer
            WHERE
                offer_id < ${offerInfo._offer.offer_id}
                AND user_id = ${offerInfo._user.telegram_id}
                AND conn_string IS NOT NULL
            ORDER BY offer_id DESC
            LIMIT 1
        `;

        //выполняем запрос в обход методов работы с таблицей заказов
        const oldOffer = await db.executeWithReturning(oldOfferSqlQuery);

        //если заказ найден, то удоляем его в системе Marzban
        if(oldOffer.length){
            const oldOfferName = `${oldOffer[0].sub_id}_${oldOffer[0].offer_id}`;
            await MarzbanAPI.DELETE_USER(oldOfferName);
            await OFFER.UPDATE(oldOffer[0].offer_id, {conn_string: null});
        }

        // Создаем нового пользователя
        const requestData = await MarzbanAPI.CREATE_USER(userData);

        //установка текста подписки пользователя и отметка что был заказ
        await OFFER.UPDATE(offerInfo._offer.offer_id, {conn_string: requestData.links[0]});
        
        //параметры для обновления пользователя
        let userUpdateOptions;
        
        //если заказ был первый - отметить пользователя как использовавший бесплатную подписку
        if(!offerInfo._user.free_trial_used) userUpdateOptions = {free_trial_used: 1};

        //сброс счетчика приглашенных для пользователя при новым заказе
        if(offerInfo._user.invite_count){
            userUpdateOptions = {...userUpdateOptions, invite_count: 0};
        }
        
        //обновление зависимостей для платного заказа
        if(offerInfo._offer.sub_id !== 'free' && offerInfo._offer.promo_id === 'friend' && offerInfo._offer.invite_code) {
            //поиск пользователя с таким промокодом
            const invitePromoCodeOwner = offerInfo._invitedBy || await USER.FIND({invite_code: offerInfo._offer.invite_code}, true);
            await USER.INCREMENT_INVITE_COUNTER(invitePromoCodeOwner.telegram_id);
        }

        //обновление пользователя
        if(userUpdateOptions) await USER.UPDATE(offerInfo._offer.user_id, userUpdateOptions);

        //если подписка бесплатная, убрать информацию о скидке и к оплате
        if(offerInfo._offer.sub_id === 'free'){
            delete offerInfo.discount;
            delete offerInfo.price;
            delete offerInfo.inviteCount;
        }

        //удаление скрытых полей
        Object.keys(offerInfo).forEach(key => {
            if(key.startsWith('_')) delete offerInfo[key];
        });

        // Ответ для сервера
        const responseData = {...offerInfo, connection: requestData.links[0]};

        //тут уведомление о новой заявке (бесплатная платная для администратора)
        //и уведомление пользователя о одобрении заявки (бесплатная одобряется сразу)

        //отправка ответа
        response.status(200, 'Обновлено');
        response.body = responseData;
        return response.send();
    }
    catch(err){
        // Сервер вернул ответ с ошибкой (например, 4xx или 5xx)
        if (err.response) {
            const statusCode = err.response.status;
            const errorMessage = err.message || err.response.data.detail;

            // Ошибка при обращении к серверу
            const error = new Error(`Marzban response: ${statusCode} ${errorMessage}`);

            //вывод ошибки в консоль
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
            // Запрос был сделан, но ответа от сервера не было
            err.message = err.message || 'Сервер Marzban не отвечает';

            // Ошибка при обращении к серверу
            const error = new Error(`Marzban sending response error: ${err.message}`);

            //вывод ошибки в консоль
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
        WriteInLogFile(err);
        response.status(500, 'Что-то пошло не так, попробуйте позже');
    }

    return response;
}

// Запуск сервера на указанном порту
app.listen(PORT, '0.0.0.0', async () => {
    console.clear();
    WriteInLogFile(`Сервер прослушивается на http://localhost:${PORT} 👂`);
});