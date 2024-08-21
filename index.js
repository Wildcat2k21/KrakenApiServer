const {USER, OFFER, SUB, PROMO} = require('./modules/Entities.js');
const MarzbanAPI = require('./modules/MarzbanAPI.js');
const Response = require('./modules/Response.js');
const Database = require('./modules/Database.js');
const {Time, WriteInLogFile} = require('./modules/Other.js');
const express = require('express');
const { checkUserFields, checkOfferFields, checkConfigFields
} = require('./modules/Data.js');
require('dotenv').config();
const fs = require('fs');

// Конфигурация
let config = require('./config.json');

//основаная конфигурация
const PORT = process.env.PORT;
const DATABASE = process.env.DATABASE_NAME;

//экземпляр базы данных
const db = new Database(`${DATABASE}.db`);
const app = express();

// Инициализация базы данных
initConnection();

//примечание: Возможно if(err.response) || err.message никогда не выполнится

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
        response.status(201, 'created')
        return response.send();
    }
    catch(err){
        return databaseErrorHandler(err, response).send();
    }
});

// Оформление заказов
app.post('/offer', async (req, res) => {

    const response = new Response(res);
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
        body.end_time = new Time().addTime(offer_sub.date_limit).toShortUnix();

        //создание нового заказа
        paymentCalc = calcPriceAndDiscount(offer_sub.price, offer_user.invite_count, offer_promo.discount);

        //создание нового заказа
        offer_id = await OFFER.NEW({...body, ...paymentCalc});
        response.status(201, 'created');
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
            response.status(404, `Заявка с offer_id: '${offerInfo.offer_id}' не найдена`);
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
            response.status(500, err.message);
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
        response.status(500, err.message);
    }

    response.send();
});

// получение подписок
app.get('/subscription', async (req, res) => {

    const response = new Response(res);
    const searchData = req.body;

    // Получение всех подписок
    try{
        response.body = await SUB.FIND(searchData);
        response.send();
    }
    catch(err){
        return databaseErrorHandler(err, response).send();
    }
});

//получение данных по фильтрам
app.get('/data', async (req, res) => {

    const response = new Response(res);

    //параметры поиска
    let {tableName, filters, limit} = req.body;

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
app.patch('/recreate', async (req, res) => {

    const response = new Response(res);
    const users = req.body.users;

    //проверка входных данных
    if(!users || !users instanceof Array || !users.length){
        response.status(417, `Пользователи для пересоздания не указаны`);
        return response.send();
    }

    const usersOffers = [];
    const dateTimeNow = new Time().toShortUnix();

    //поиск заказов
    try{
        //получение последних заказов
        for(let i = 0; i < users.length; i++){
            const allSelectedUsersSql = `SELECT * FROM offer WHERE user_id = ${users[i]} AND end_time > ${dateTimeNow} ORDER BY offer_id DESC LIMIT 1`;
            const offerForUser = await db.executeWithReturning(allSelectedUsersSql);
            
            //получение информации о заказе
            if(offerForUser.length){
                const offerSub = await SUB.FIND({name_id: offerForUser[0].sub_id}, true);
                offerForUser[0].data_limit = offerSub[0].data_limit;
                offerForUser[0].date_limit = offerSub[0].date_limit;
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
            const expire = usersOffers[i].date_limit;
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

            //обновление строки подключения в заказе
            await OFFER.UPDATE(usersOffers[i].offer_id, {conn_string:  requestData.links[0]});
        }

        response.status(200, `Пересоздано заявок: ${usersOffers.length}`);
        response.send();
        
    }catch(err){

        // Сервер вернул ответ с ошибкой (например, 4xx или 5xx)
        if (err.response) {
            const statusCode = err.response.status;
            const errorMessage = err.message || err.response.data.detail.body;

            // Ошибка при обращении к серверу
            const error = new Error(`Marzban response ${statusCode}: ${errorMessage}`);

            //вывод ошибки в консоль
            WriteInLogFile(error);

            response.status(statusCode, errorMessage);
            return response.send();
        } 
        //остальные ошибки
        else {
            // Запрос был сделан, но ответа от сервера не было
            err.message = err.message || 'Сервер Marzban не отвечает';

            // Ошибка при обращении к серверу
            const error = new Error(`Marzban sending response error: ${err.message}`);

            //вывод ошибки в консоль
            WriteInLogFile(error);

            response.status(500, err.message);
            return response.send();
        }
    }
});

//обновление данных
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

        //удаляем предыдущий заказ, если таковой имеется
        const oldOffer = offerInfo._offer.offer_id - 1;

        //если есть старый заказ в системе Marzban - то удаляем его.
        if(oldOffer > 0){

            //ищем не истекший предыдущей заказ
            const oldOfferInfo = await OFFER.FIND({offer_id: oldOffer}, true);
            const dateTimeNow = new Time().toShortUnix();
            
            //удаляем заказ в систиме Marzban
            if(oldOfferInfo && oldOfferInfo.end_time < dateTimeNow){
                const oldOfferName = `${oldOffer.sub_id}_${oldOffer.offer_id}`;
                await MarzbanAPI.DELETE_USER(oldOfferName);
            }
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

        //отправка ответа
        response.status(201, 'created');
        response.body = responseData;
        return response.send();
    }
    catch(err){
        // Сервер вернул ответ с ошибкой (например, 4xx или 5xx)
        if (err.response) {
            const statusCode = err.response.status;
            const errorMessage = err.message || err.response.data.detail.body;

            // Ошибка при обращении к серверу
            const error = new Error(`Marzban response ${statusCode}: ${errorMessage}`);

            //вывод ошибки в консоль
            WriteInLogFile(error);

            response.status(statusCode, errorMessage);
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

            response.status(500, err.message);
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
        response.status(409, err.message);
    }
    // Обработка ошибок синтаксиса
    else if (err.message.indexOf('SQLITE_ERROR') !== -1){
        response.status(417, err.message);
    }
    // Обработка критических ошибок
    else {
        WriteInLogFile(err);
        response.status(500, err.message);
    }

    return response;
}

// Запуск сервера на указанном порту
app.listen(PORT, '0.0.0.0', async () => {
    console.clear();
    WriteInLogFile(`Сервер прослушивается на http://localhost:${PORT}`);
});