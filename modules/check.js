async function confirmOffer(offerInfo, response){

    //примечание по улучшению .
    //по крайней мере 3 запроса переиспользуются с одними и те же данныеми
    //1. offerInfo._offer = OFFER.FIND({offer_id: offerInfo.offer_id}, true);
    //2. SUB.FIND({name_id: offerInfo._offer.sub_id}, true);
    //3. USER.FIND({telegram_id: offerInfo._offer.user_id, free_trial_used: 0}, true);
    //4. USER.FIND({telegram_id: offerInfo._offer.user_id, invite_count: 0}, true);
    //примечание 2. Бесплатный заказ проходит, так как нет проверки в /offer и там создается таблица нового заказа
    //примечание 3. Существующий заказ не проходит в /confirm так как проверка реализовано тут (confirmOffer)

    //отметка одобрения заказа
    try{
        // //если такой заявки нет
        // if(!offerInfo._offer){
        //     response.status(404, `Заявка с offer_id: '${offerInfo.offer_id}' не найдена`);
        //     return response.send();
        // }

        // //проверка на одобрение заказа ранее
        // if(offerInfo._offer.conn_string){
        //     response.status(409, 'Заявка уже одобрена');
        //     return response.send();
        // }

        //уникальный имена для тарифа
        const username = `${offerInfo._sub.name_id}_${offerInfo._offer.offer_id}`;

        //установка даты окончания подписки
        const expire = new Time().addTime(offerInfo._sub.date_limit * 86400000).toShortUnix();

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

        // Создаем нового пользователя
        const requestData = await MarzbanAPI.CREATE_USER(userData);

        //установка текста подписки пользователя и отметка что был заказ
        await OFFER.UPDATE(offerInfo._offer.offer_id, {conn_string: requestData.links[0]});
        
        //параметры для обновления пользователя
        let userUpdateOptions;
        
        //если заказ был первый - отметить пользователя как использовавший бесплатную подписку
        if(!offerInfo._user.free_trial_used) userUpdateOptions = {free_trial_used: 1};

        //обновление зависимостей для платного заказа
        if(offerInfo._offer.sub_id !== 'free') {
            //сброс счетчика приглашенных для пользователя при новым заказе
            if(!offerInfo._user.invite_count){
                userUpdateOptions = {...userUpdateOptions, invite_count: 0};
            }

            //повышаем счетчик приглашенных пользователей
            if(offerInfo._offer.promo_id === 'friend' && offerInfo._offer.invite_code){
                //поиск пользователя с таким промокодом
                const invitePromoCodeOwner = offerInfo._invitedBy || await USER.FIND({invite_code: offerInfo._offer.invite_code}, true);
                await USER.INCREMENT_INVITE_COUNTER(invitePromoCodeOwner.telegram_id);
            }
        }

        //обновление пользователя
        if(userUpdateOptions) await USER.UPDATE(offerInfo._offer.user_id, userUpdateOptions);

        //удаление скрытых полей
        delete offerInfo._user;
        delete offerInfo._offer;
        delete offerInfo._sub;

        //если подписка бесплатная, убрать информацию о скидке и к оплате
        if(offerInfo._offer.sub_id === 'free'){
            delete offerInfo.discount;
            delete offerInfo.price;
        }

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