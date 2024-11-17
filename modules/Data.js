function checkUserFields(data){
    const requedFields = {
        'nickname': {
            max_length: 100,
            name: 'Никнейм'
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

function checkOfferFields(data){
    const requedFields = {
        'user_id': {
            name: 'Идентификатор пользователя',
            type: 'number'
        },
        'sub_id': {
            name: 'Идентификатор подписки'
        }
    }

    // Проверяем типы полей
    checkMiddleFunction(requedFields, data);
}

// Функция для проверка полей конфигурации
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
        },
        "accept_new_offers" : {
            type: 'number'
        },
        "new_offers_limis_message": {
            type: 'string'
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

        // Присвоение имени полю, если оно не передано
        options.name = options.name || keys[i];
        if(!(keys[i] in data)){
            const textInputError = new Error(`Поле '${options.name}' не передано`);
            textInputError.dataCheck = true;
            throw textInputError;
        };

        // Проверка типа полей, предпологается что тип по умолчанию string
        if((options.type || 'string') !== typeof currentDataValue) {
            const textInputError = new Error(`Поле '${options.name}' имеет неверный формат`);
            textInputError.dataCheck = true;
            throw textInputError;
        }
    
        // Проверка на максимульную длину поля
        if('max_length' in options){
            if(currentDataValue.length > options.max_length){
                const textInputError = new Error(`Поле ${options.name} слишком длинное`);
                textInputError.dataCheck = true;
                throw textInputError;
            }
        }

        // Проверка на соответствие длины поля
        if('length' in options){
            if(currentDataValue.length !== options.length){
                const textInputError = new Error(`Поле ${options.name} имеет неправильную длину`);
                textInputError.dataCheck = true;
                throw textInputError;
            }
        }
    }
}

export default {checkUserFields, checkOfferFields, checkConfigFields};