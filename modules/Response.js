class Response {

    constructor(res, status = 200, message = 'ok', body = null) {
        this.res = res; // Сохраняем объект res
        this.status(status, message);
        this.body = body;
    }

    // Установка статуса
    status(code, message) {
        this._status = code;
        this._message = message;
        return this;
    }

    // Получения объекта ответа
    toObject(){
        return {
            status: this._status,
            message: this._message,
            body: this._body
        }
    }

    // Установка тела
    set body(data) {
        this._body = data;
    }

    // Получение тела
    get body() {
        return this._body;
    }

    // Метод для отправки
    send() {
        if (this._body) this.res.status(this._status).send(this._body);
        else this.res.status(this._status).send(this._message);
    }
}

export default Response;