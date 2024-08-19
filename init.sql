-- Промокоды
CREATE TABLE promo (
    name_id TEXT PRIMARY KEY CHECK(LENGTH(name_id) <= 10),
    title TEXT NOT NULL CHECK(LENGTH(title) <= 50),
    discount INTEGER DEFAULT 0 CHECK(discount <= 100)  -- Ограничение на скидку до 100
);

-- Подписки
CREATE TABLE sub (
    name_id TEXT PRIMARY KEY CHECK(LENGTH(name_id) <= 15),
    title TEXT NOT NULL CHECK(LENGTH(title) <= 50),
    data_limit INTEGER NOT NULL,
    date_limit INTEGER NOT NULL,
    price INTEGER NOT NULL,
    with_promo INTEGER DEFAULT 0
);

-- Пользователи
CREATE TABLE user (
    telegram_id INTEGER PRIMARY KEY,
    full_name TEXT NOT NULL CHECK(LENGTH(full_name) <= 100),
    education_status TEXT NOT NULL CHECK(LENGTH(education_status) <= 50),
    phone_number TEXT NOT NULL CHECK(LENGTH(phone_number) <= 15),
    email TEXT NOT NULL CHECK(LENGTH(email) <= 100),
    registration_date TEXT NOT NULL CHECK(LENGTH(registration_date) = 10),
    telegram TEXT NOT NULL CHECK(LENGTH(telegram) <= 32),
    free_trial_used INTEGER DEFAULT 0,
    invite_code TEXT NOT NULL CHECK(LENGTH(invite_code) = 4) UNIQUE,
    invite_count INTEGER DEFAULT 0
);

-- Заказы
CREATE TABLE `order` (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    sub_id INTEGER NOT NULL,
    promo_id TEXT NOT NULL,
    invite_code TEXT DEFAULT NULL,
    payment INTEGER NOT NULL,
    resolved INTEGER DEFAULT 0,
    conn_string TEXT DEFAULT NULL,
    created_date TEXT NOT NULL CHECK(LENGTH(created_date) = 10),
    FOREIGN KEY (user_id) REFERENCES user(telegram_id),
    FOREIGN KEY (sub_id) REFERENCES sub(name_id),
    FOREIGN KEY (promo_id) REFERENCES promo(name_id)
);

--- подписки ---

-- Вставка подписки "Free Trial"
INSERT INTO sub (name_id, title, data_limit, date_limit, price, with_promo) 
VALUES ('free', 'Бесплатная', 0, 1, 0, 0);

-- Вставка подписки "Basic"
INSERT INTO sub (name_id, title, data_limit, date_limit, price, with_promo) 
VALUES ('basic', 'Базовый', 0, 30, 250, 1);

--- промокоды ---

-- Вставка промокода default
INSERT INTO promo (name_id, title, discount) 
VALUES ('default', '#БезПромокода', 0);

-- Вставка промокода ytube
INSERT INTO promo (name_id, title, discount) 
VALUES ('ytube', '#НезамедлительноЮтюб', 5);

-- Вставка промокода friend
INSERT INTO promo (name_id, title, discount) 
VALUES ('friend', '#Друзья', 10);

-- Вставка промокода &9%D0T
INSERT INTO promo (name_id, title, discount) 
VALUES ('&9%D0T', '#ЗнаюРазработчика', 50);
