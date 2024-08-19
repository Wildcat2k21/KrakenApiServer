function checkUserFields(data){
    const requedFields = {
        'full_name': {
            max_length: 100,
            name: 'ФИО'
        },
        'education_status': {
            max_length: 50,
            name: 'Учёная степень'
        },
        'phone_number': {
            max_length: 15,
            name: 'Номер телефона',
            type: 'number'
        },
        'email': {
            max_length: 100,
            name: 'Email'
        },
        'telegram': {
            max_length: 32,
            name: 'Телеграм'
        },
        'telegram_id': {
            name: 'Телеграм ID',
            type: 'number'
        }
    }

    // Проверяем типы полей
    checkMiddleFunction(requedFields, data);
}

function checkSubInfoFields(data){
    const requedFields = {
        'offer_id': {
            name: 'Идентификатор заказа',
            type: 'number'
        },
        'subname': {
            name: 'Название подписки'
        },
        'price': {
            name: 'Цена подписки',
            type: 'number'
        },
        'promoName': {
            name: 'Название промокода'
        },
        'discount': {
            name: 'Скидка',
            type: 'number'
        },
        'toPay': {
            name: 'К оплате',
            type: 'number'
        }
    }

    // Проверяем типы полей
    checkMiddleFunction(requedFields, data);
}

function checkOfferFields(data){
    const requedFields = {
        'user_id': {
            name: 'Идентификатор пользователя',
            type: 'number'
        },
        'sub_id': {
            name: 'Идентификатор подписки'
        },
        'payment': {
            name: 'Оплата',
            type: 'number'
        }
    }

    // Проверяем типы полей
    checkMiddleFunction(requedFields, data);
}

//функция для проверка полей конфигурации
function checkConfigFields(data){
    const requedFields = {
        'auto_accept_free_trial': {
            type: 'number'
        },
        'total_participants_limit': {
            type: 'number',
        },
        'welcome_message' : {
            type: 'string'
        },
        'limit_participants_message' : {
            type: 'string'
        },
        "invite_discount": {
            type: 'number'
        }
    }

    // Проверяем типы полей
    checkMiddleFunction(requedFields, data);
}

function checkMiddleFunction(requedFields, data){

    // Проверяем наличие обязательных полей
    const keys = Object.keys(requedFields);

    // Проверяем тип и ограничение полей
    for(let i = 0; i < keys.length; i++){

        const options = requedFields[keys[i]];
        const currentDataValue = data[keys[i]];

        //присвоение имени полю, если оно не передано
        options.name = options.name || keys[i];
        if(!(keys[i] in data)) throw new Error(`Поле '${options.name}' не передано`);

        //проверка типа полей, предпологается что тип по умолчанию string
        if((options.type || 'string') !== typeof currentDataValue) {
            throw new Error(`Поле '${options.name}' имеет неверный формат`);
        }
    
        //проверка на максимульную длину поля
        if('max_length' in options){
            if(currentDataValue.length > options.max_length) throw new Error(`Поле ${options.name} слишком длинное`);
        }

        //проверка на соответствие длины поля
        if('length' in options){
            if(currentDataValue.length !== options.length) throw new Error(`Поле ${options.name} имеет неправильную длину`);
        }
    }
}

module.exports = {checkUserFields, checkOfferFields, checkConfigFields, checkSubInfoFields};