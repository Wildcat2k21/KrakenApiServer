const {USER, OFFER, SUB, PROMO} = require('./modules/Entities.js');
const MarzbanAPI = require('./modules/MarzbanAPI.js');
const Response = require('./modules/Response.js');
const Database = require('./modules/Database.js');
const {Time} = require('./modules/Other.js');
const express = require('express');
const { checkUserFields, checkOfferFields,
        checkConfigFields, checkSubInfoFields
} = require('./modules/Data.js');
require('dotenv').config();
const fs = require('fs');

// Конфигурация
let config = require('./config.json');
const { resolve } = require('path');

//основаная конфигурация
const PORT = process.env.PORT;
const DATABASE = process.env.DATABASE_NAME;

//экземпляр базы данных
const db = new Database(`${DATABASE}.db`);
const app = express();

// Инициализация базы данных
initConnection();

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

// Получение пользователей
app.get('/user', async (req, res) => {

    const response = new Response(res);
    const searchData = req.body;

    //поиск пользователя по фильтрам
    try{
        const users = await USER.FIND(searchData);
        response.body = users;
        response.send();
    }
    catch(err){
        return databaseErrorHandler(err, response).send();
    }
})

// Оформление заказов
app.post('/offer', async (req, res) => {

    const response = new Response(res);
    const body = req.body;
    
    //идентификатор заказа
    let offer_promo = undefined, offer_id = undefined;

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

        //проверка бесплатной подписки на первый заказ
        if(body.sub_id === 'free'){
            //поиск отметки на первый заказ
            const isUserIsMakeFirstOffer = await USER.FIND({telegram_id: body.user_id, free_trial_used: 1}, true);

            //отказ пользователю в бесплатной подписке если заказ не первый
            if(isUserIsMakeFirstOffer){
                response.status(403, 'Пробная подписка доступна только на первый заказ');
                return response.send();
            }
        }

        //если промокод не передан - применяется промокод по умолчанию
        if(!body.promo_id){
            offer_promo = await PROMO.FIND({name_id: 'default'}, true);
        }
        else {
            //проверка на пользовательский промокод
            const invitedByUser = await USER.FIND({invite_code: body.promo_id}, true);

            //выставление промокодов
            if(invitedByUser){
                offer_promo = await PROMO.FIND({name_id: 'friend'}, true);
                //вынесение кода приглашения в отдельное поле
                body.invite_code = body.promo_id;
            }
            else if(body.promo_id !== 'friend'){
                offer_promo = await PROMO.FIND({name_id: body.promo_id}, true);
            }
            else {
                offer_promo = undefined;
            }

            //проверка существования промокода
            if(!offer_promo){
                response.status(404, `Промокод '${body.promo_id}' не найден`);
                return response.send();
            }
        }

        //подмена промокода
        body.promo_id = offer_promo.name_id;

        //создание нового заказа
        offer_id = await OFFER.NEW(body);
        response.status(201, 'created');
    }
    catch(err){
        return databaseErrorHandler(err, response).send();
    }

    //тут считаем скидку и возвращаем объект оплаты
    try{
        //создание деталей подписки
        const offerDetails = await createOfferDetails(offer_id);

        //проверка автооформление бесплатной подписки
        if(config.auto_accept_free_trial && body.sub_id === 'free'){
            //метод имеет внутрюю обработку ошибок
            return await confirOffer(offerDetails, response);
        }

        //отправка ответа
        response.body = offerDetails;

        //отправка ответа
        response.send();

    }catch(err){
        return databaseErrorHandler(err, response).send();
    }
});

//получение всех заказов
app.get('/offer', async (req, res) => {

    const response = new Response(res);
    const searchData = req.body;

    //получение заказов по фильтрам
    try{
        const offers = await OFFER.FIND(searchData);
        response.body = offers;
        response.send();
    }
    catch(err){
        return databaseErrorHandler(err, response).send();
    }
});

//одобрение заказа
app.post('/resolveOffer', async (req, res) => {
    const response = new Response(res);
    const offer_id = req.body.offer_id;

    if(!offer_id){
        response.status(417, 'Не передан идентификатор заказа');
        return response.send();
    }

    try{
        //получение данных о заказе
        const offerDetails = await createOfferDetails(offer_id);

        //метод имеет внутренюю обработку ошибок
        await confirOffer(offerDetails, response);

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
            console.error(err);
            response.status(500, 'Не удалось изменить конфигурацию API server');
        };
    });

    // Изменение конфигурации сервера
    response.body = config = req.body;
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

//генерация ответа для заказа пользователя
async function createOfferDetails(offer_id){
    //рассматриваемый заказ
    const accepting = await OFFER.FIND({offer_id}, true);
    const offer_sub = await SUB.FIND({name_id: accepting.sub_id}, true);
    const offer_promo = await PROMO.FIND({name_id: accepting.promo_id}, true);
    const offer_user = await USER.FIND({telegram_id: accepting.user_id}, true);

    //скидки на оформление
    const promoPrice = offer_sub.price * (1 - offer_promo.discount/100);
    const invitPrice = promoPrice * (1 - config.invite_discount/100 * offer_user.invite_count);
    const priceToPay = Math.ceil(invitPrice);

    //исключение отрицательной цены
    const payment = (priceToPay < 0) ? 0 : priceToPay;

    //информация для пользователя
    const offerDetails = {
        offer_id,
        subname: offer_sub.title,
        price: offer_sub.price,
        toPay: payment,
        discount: offer_promo.discount,
        promoName: offer_promo.title
    }
    
    return offerDetails;
}

async function confirOffer(offerInfo, response){

    //проверка полей объекта подписки
    try{
        checkSubInfoFields(offerInfo);

    }catch(err){
        response.status(417, err.message);
        return response.send();
    }
    
    //отметка одобрения заказа
    try{
        //поиск деталей заказа
        const offerDetails = await OFFER.FIND({offer_id: offerInfo.offer_id}, true);

        //если такой заявки нет
        if(!offerDetails){
            response.status(404, `Заявка с offer_id: '${offerInfo.offer_id}' не найдена`);
            return response.send();
        }

        //проверка на одобрение заказа ранее
        if(offerDetails.resolved){
            response.status(409, 'Заявка уже одобрена');
            return response.send();
        }

        //получение информации о подписке
        const subForOffer = await SUB.FIND({name_id: offerDetails.sub_id}, true);

        //уникальный имена для тарифа
        const username = `${subForOffer.name_id}_${offerDetails.offer_id}`;

        //установка даты окончания подписки
        const expire = new Time().addTime(subForOffer.date_limit * 86400000).toShortUnix();

        //лимит данных
        const data_limit = subForOffer.data_limit * 1024**3;

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

        // Создаем нового пользователя
        const requestData = await MarzbanAPI.CREATE_USER(userData);

        //установка текста подписки пользователя и отметка что был заказ
        await OFFER.SET_CONNECTION_STRING(offerDetails.offer_id, requestData.links[0]);
        await OFFER.RESOLVE(offerDetails.offer_id);
        
        //проверка заказа на первый
        const offerUserFreeTrial = await USER.FIND({telegram_id: offerDetails.user_id, free_trial_used: 0}, true);

        //если заказ был первый - отметить пользователя как использовавший бесплатную подписку
        if(offerUserFreeTrial) await USER.UPDATE(telegram_id, {free_trial_used: 1});

        //если подписка бесплатная, убрать информацию о скидке и к оплате
        if(offerDetails.sub_id === 'free'){
            delete offerInfo.discount;
            delete offerInfo.price;
        }
        //повышаем счетчик приглашенных пользователей
        else if(offerDetails.promo_id === 'friend' && offerDetails.invite_code){
            //поиск пользователя с таким промокодом                   ИМЕЕТ УЖЕ НЕ ТОТ КОД TELEGRAM ИЗ-ЗА ПОДМЕНЫ
            const invitePromoCodeOwner = await USER.FIND({invite_code: offerDetails.invite_code}, true);
            await USER.INCREMENT_INVITE_COUNTER(invitePromoCodeOwner.telegram_id);
        }
        else {}

        // Ответ для сервера
        const responseData = {...offerInfo, connection: requestData.links[0]};

        //отправка ответа
        response.status(201, 'created');
        response.body = responseData;

        //тут push для API сервисов

        return response.send();
    }
    catch(err){

        // Сервер вернул ответ с ошибкой (например, 4xx или 5xx)
        if (err.response) {
            const statusCode = err.response.status;
            const errorMessage = err.response.data || err.message;
            response.status(statusCode, errorMessage);
            return response.send();
        } 
        //обработка ошибок базы данных
        else if(err.message && err.message.indexOf('SQLITE') !== -1){
            return databaseErrorHandler(err, response).send();

        } else {
            // Запрос был сделан, но ответа от сервера не было
            const resMessage = err.message || 'Сервер Marzban не отвечает';
            response.status(500, resMessage);
            console.error(resMessage);
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
        console.error(err.message);
        throw err;
    }
}

function databaseErrorHandler(err, response){

    // Обработка ограничений
    if(err.message.indexOf('SQLITE_CONSTRAINT') !== -1){
        response.status(409, `Нарушено ограничение целостности данных / ${err.message}`);
    }
    // Обработка ошибок синтаксиса
    else if (err.message.indexOf('SQLITE_ERROR') !== -1){
        response.status(417, `Ошибка синтаксиса / ${err.message}`);
    }
    // Обработка критических ошибок
    else {
        console.error(err);
        response.status(500, err.message);
    }

    return response;
}

// Запуск сервера на указанном порту
app.listen(PORT, '0.0.0.0', () => {
    console.clear();
    console.log(`Сервер прослушивается на http://localhost:${PORT}`);
});