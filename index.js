const {USER, ORDER, SUB, PROMO} = require('./modules/Entities.js');
const MarzbanAPI = require('./modules/MarzbanAPI.js');
const Response = require('./modules/Response.js');
const Database = require('./modules/Database.js');
const {Time} = require('./modules/Other.js');
const express = require('express');
const { checkUserFields, checkOrderFields,
        checkConfigFields, checkSubInfoFields
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

// Инициализация сущностей
const user = new USER(db);
const order = new ORDER(db);
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
app.post('/order', async (req, res) => {

    const response = new Response(res);
    const body = req.body;
    
    //идентификатор заказа
    let order_promo = undefined, order_new = undefined;

    // Проверка на поля заказа
    try{
        checkOrderFields(body);
    }
    catch(err){
        response.status(417, err.message);
        return response.send();
    }

    // Добавление нового заказа
    try{

        //если промокод не передан - применяется промокод по умолчанию
        if(!body.promo_id){
            order_promo = await PROMO.FIND({name_id: 'default'}, true);
        }
        else {
            //проверка на пользовательский промокод
            const invitedByUser = await USER.FIND({invite_code: body.promo_id}, true);

            //выставление промокодов
            if(invitedByUser){
                order_promo = await PROMO.FIND({name_id: 'friend'}, true);
                //вынесение кода приглашения в отдельное поле
                body.invite_code = body.promo_id;
            }
            else if(body.promo_id !== 'friend'){
                order_promo = await PROMO.FIND({name_id: body.promo_id}, true);
            }
            else {
                order_promo = undefined;
            }

            //проверка существования промокода
            if(!order_promo){
                response.status(404, `Промокод '${body.promo_id}' не найден`);
                return response.send();
            }
        }

        //подмена промокода
        body.promo_id = order_promo.name_id;

        //создание нового заказа
        order_new = await ORDER.NEW(body);
        response.status(201, 'created');
    }
    catch(err){
        return databaseErrorHandler(err, response).send();
    }

    //тут считаем скидку и возвращаем объект оплаты
    try{
        const order_sub = await SUB.FIND({name_id: body.sub_id}, true);
        const payment = Math.ceil(order_sub.price * (1 - order_promo.discount/100));

        //информация для пользователя
        const orderDetails = {
            order_id: order_new.order_id,
            subname: order_sub.title,
            price: order_sub.price,
            toPay: payment,
            discount: order_promo.discount,
            promoName: order_promo.title
        }

        //проверка автооформление бесплатной подписки
        if(config.auto_accept_free_trial && body.sub_id === 'free'){
            //метод имеет внутрюю обработку ошибок
            return await confirOrder(orderDetails, response);
        }

        //отправка ответа
        response.body = orderDetails;

        //отправка ответа
        response.send();

    }catch(err){
        return databaseErrorHandler(err, response).send();
    }
});

//получение всех заказов
app.get('/order', async (req, res) => {

    const response = new Response(res);
    const searchData = req.body;

    //получение заказов по фильтрам
    try{
        const orders = await ORDER.FIND(searchData);
        response.body = orders;
        response.send();
    }
    catch(err){
        return databaseErrorHandler(err, response).send();
    }
});

//одобрение заказа
app.post('/resolveOrder', async (req, res) => {
    const response = new Response(res);
    const order_id = req.body.order_id;

    if(!order_id){
        response.status(417, 'Не передан идентификатор заказа');
        return response.send();
    }

    try{
        //рассматриваемый заказ
        const accepting = await ORDER.FIND({order_id}, true);
        const order_sub = await SUB.FIND({name_id: accepting.sub_id}, true);
        const order_promo = await PROMO.FIND({name_id: accepting.promo_id}, true);
        const order_user = await USER.FIND({telegram_id: accepting.user_id}, true);

        //скидки на оформление
        const promoPrice = order_sub.price * (1 - order_promo.discount/100);
        const invitPrice = promoPrice * (1 - config.invite_discount/100 * order_user.invite_count);
        const priceToPay = Math.ceil(invitPrice);

        //исключение отрицательной цены
        const payment = (priceToPay < 0) ? 0 : priceToPay;

        //информация для пользователя
        const orderDetails = {
            order_id,
            subname: order_sub.title,
            price: order_sub.price,
            toPay: payment,
            discount: order_promo.discount,
            promoName: order_promo.title
        }

        //метод имеет внутренюю обработку ошибок
        await confirOrder(orderDetails, response);

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

async function confirOrder(orderInfo, response){

    //проверка полей объекта подписки
    try{
        checkSubInfoFields(orderInfo);

    }catch(err){
        response.status(417, err.message);
        return response.send();
    }
    
    //отметка одобрения заказа
    try{
        //поиск деталей заказа
        const orderDetails = await ORDER.FIND({order_id: orderInfo.order_id}, true);

        //если такой заявки нет
        if(!orderDetails){
            response.status(404, `Заявка с order_id: '${orderInfo.order_id}' не найдена`);
            return response.send();
        }

        //проверка на одобрение заказа ранее
        if(orderDetails.resolved){
            response.status(409, 'Заявка уже одобрена');
            return response.send();
        }

        //получение информации о подписке
        const subForOrder = await SUB.FIND({name_id: orderDetails.sub_id}, true);

        //уникальный имена для тарифа
        const username = `${subForOrder.name_id}_${orderDetails.order_id}`;

        //установка даты окончания подписки
        const expire = new Time().addTime(subForOrder.date_limit * 86400000).toShortUnix();

        //лимит данных
        const data_limit = subForOrder.data_limit * 1024**3;

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

        //установка текста подписки пользователя
        await ORDER.SET_CONNECTION_STRING(orderDetails.order_id, requestData.links[0]);
        await ORDER.RESOLVE(orderDetails.order_id);

        //если подписка бесплатная, убрать информацию о скидке и к оплате
        if(orderDetails.sub_id === 'free'){
            delete orderInfo.discount;
            delete orderInfo.price;
        }
        //повышаем счетчик приглашенных пользователей
        else if(orderDetails.promo_id === 'friend' && orderDetails.invite_code){
            //поиск пользователя с таким промокодом                   ИМЕЕТ УЖЕ НЕ ТОТ КОД TELEGRAM ИЗ-ЗА ПОДМЕНЫ
            const invitePromoCodeOwner = await USER.FIND({invite_code: orderDetails.invite_code}, true);
            console.log(1, invitePromoCodeOwner.telegram_id);
            await USER.INCREMENT_INVITE_COUNTER(invitePromoCodeOwner.telegram_id);
            console.log(2, invitePromoCodeOwner.telegram_id);
        }
        else {}

        // Ответ для сервера
        const responseData = {...orderInfo, connection: requestData.links[0]};

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