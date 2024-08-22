const {Time, RandCode} = require('./Other');

//пользователи
class USER {

    static database = null;

    constructor(database) {
        USER.database = database; // Инициализация статического свойства через конструктор
    }

    //поиск пользвоателя
    static async FIND(params, limit, desc){
        return await USER.database.find('user', params, limit, desc);
    }

    //подсчет количества записей
    static async COUNT(){
        const data = await USER.database.executeWithReturning('SELECT COUNT(*) FROM user');
        return data[0]['COUNT(*)'];
    }

    //увеличение счетчика приглашенных пользователей
    static async INCREMENT_INVITE_COUNTER(telegram_id){
        return await USER.database.executeNoDataReturning(`UPDATE user SET invite_count = invite_count + 1 WHERE telegram_id = ${telegram_id}`);
    }

    //обновление пользователя
    static async UPDATE(telegram_id, update){
        return await USER.database.update('user', update, {telegram_id});
    }

    //добавление пользователя
    static async NEW(data){

        //уникальный инвайт-код пользователя
        let invite_code = RandCode(4);

        //check for unique code and retry if not unique <-------------- might change
        while(Array.from(await USER.database.find('user', {invite_code})).length){
            invite_code = RandCode(4);
        }

        //установление даты регистрации
        const registration_date = new Time().shortUnix();
        const dataWithDate = {...data, registration_date, invite_code};

        //выполнение запроса
        return await USER.database.insert('user', dataWithDate);
    }
}

//заказы
class OFFER {

    static database = null;

    constructor(database) {
        OFFER.database = database; // Инициализация статического свойства через конструктор
    }

    //поиск заказов
    static async FIND(params, limit, desc){
        return await OFFER.database.find('offer', params, limit, desc);
    }

    //добавление заказа
    static async NEW(data){
        //установление даты заказа
        const created_date = new Time().shortUnix();
        const offerWithDate = {...data, created_date};

        return await OFFER.database.insert('offer', offerWithDate);
    }

        //обновление пользователя
    static async UPDATE(offer_id, update){
        return await OFFER.database.update('offer', update, {offer_id});
    }
}

// Подписки
class SUB {

    static database = null;

    constructor(database) {
        SUB.database = database; // Инициализация статического свойства через конструктор
    }

    //поиск подписок
    static async FIND(params, limit, desc){
        return await SUB.database.find('sub', params, limit, desc);
    }
}

// Промокоды
class PROMO {

    static database = null;

    constructor(database) {
        PROMO.database = database; // Инициализация статического свойства через конструктор
    }

    //поиск промокодов
    static async FIND(params, limit, desc){
        return await PROMO.database.find('promo', params, limit, desc);
    }
}

module.exports = {USER, OFFER, SUB, PROMO}