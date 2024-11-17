import Other from './Other.js';
import Time from './Time.js';

const {RandCode} = Other;

// Пользователи
class USER {

    static database = null;

    constructor(database) {
        USER.database = database; // Инициализация статического свойства через конструктор
    }

    // Поиск пользвоателя
    static async FIND(condition, limit, desc){
        return await USER.database.find('user', condition, limit, desc);
    }

    // Подсчет количества записей
    static async COUNT(){
        const data = await USER.database.executeWithReturning('SELECT COUNT(*) FROM user');
        return data[0]['COUNT(*)'];
    }

    // Увеличение счетчика приглашенных пользователей
    static async INCREMENT_INVITE_COUNTER(telegram_id){
        return await USER.database.executeNoDataReturning(`UPDATE user SET invite_count = invite_count + 1 WHERE telegram_id = ${telegram_id}`);
    }

    // Обновление пользователя
    static async UPDATE(telegram_id, update){
        return await USER.database.update('user', update, [[{
                field: 'telegram_id',
                exacly: telegram_id
            }]]);
    }

    // Добавление пользователя
    static async NEW(data){

        // Уникальный инвайт-код пользователя
        let invite_code = RandCode(4);

        while((await USER.database.find('user', [[{field: 'invite_code', exacly: invite_code}]], true))){
            invite_code = RandCode(4);
        }

        // Установление даты регистрации
        const registration_date = new Time().shortUnix();
        const dataWithDate = {...data, registration_date, invite_code};

        // Выполнение запроса
        return await USER.database.insert('user', dataWithDate);
    }
}

// Заказы
class OFFER {

    static database = null;

    constructor(database) {
        OFFER.database = database; // Инициализация статического свойства через конструктор
    }

    // Поиск заказов
    static async FIND(condition, limit, desc){
        return await OFFER.database.find('offer', condition, limit, desc);
    }

    // Добавление заказа
    static async NEW(data){
        // Установление даты заказа
        const created_date = new Time().shortUnix();
        const offerWithDate = {...data, created_date};

        return await OFFER.database.insert('offer', offerWithDate);
    }

    //удаление заявки
    static async DELETE(offer_id){
        return await OFFER.database.delete('offer', [[{field : 'offer_id', exacly: offer_id}]]);
    }

    // Обновление пользователя
    static async UPDATE(offer_id, update){
        return await OFFER.database.update('offer', update, [[{field : 'offer_id', exacly: offer_id}]]);
    }
}

// Подписки
class SUB {

    static database = null;

    constructor(database) {
        SUB.database = database; // Инициализация статического свойства через конструктор
    }

    // Поиск подписок
    static async FIND(condition, limit, desc){
        return await SUB.database.find('sub', condition, limit, desc);
    }
}

// Промокоды
class PROMO {

    static database = null;

    constructor(database) {
        PROMO.database = database;
    }

    // Поиск промокодов
    static async FIND(condition, limit, desc){
        return await PROMO.database.find('promo', condition, limit, desc);
    }
}

export default {USER, OFFER, SUB, PROMO}