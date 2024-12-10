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
    nickname TEXT NOT NULL CHECK(LENGTH(nickname) <= 100),
    registration_date INTEGER NOT NULL,
    telegram TEXT NOT NULL CHECK(LENGTH(telegram) <= 32),
    free_trial_used INTEGER DEFAULT 0,
    invite_code TEXT NOT NULL CHECK(LENGTH(invite_code) = 4) UNIQUE,
    invite_count INTEGER DEFAULT 0,
    invited_with_code TEXT DEFAULT NULL,
    blocked INTEGER DEFAULT 0
);

-- Заказы
CREATE TABLE offer (
    offer_id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    sub_id INTEGER NOT NULL,
    promo_id TEXT NOT NULL,
    payment INTEGER NOT NULL,
    discount INTEGER DEFAULT 0 CHECK(discount <= 100),
    conn_string TEXT DEFAULT NULL,
    created_date INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES user(telegram_id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (sub_id) REFERENCES sub(name_id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (promo_id) REFERENCES promo(name_id) ON DELETE CASCADE ON UPDATE CASCADE
);

--- подписки ---

-- -- Вставка подписки "Free Trial"
-- INSERT INTO sub (name_id, title, data_limit, date_limit, price, with_promo) 
-- VALUES ('free', 'Бесплатная', 5, 2592000, 0, 0);

-- -- Вставка подписки "Free Trial"
-- INSERT INTO sub (name_id, title, data_limit, date_limit, price, with_promo) 
-- VALUES ('light', 'Лайт', 30, 2592000, 100, 1);

-- -- Вставка подписки "Free Trial"
-- INSERT INTO sub (name_id, title, data_limit, date_limit, price, with_promo) 
-- VALUES ('light_plus', 'Лайт плюс', 50, 2592000, 150, 1);

-- -- Вставка подписки "Free Trial"
-- INSERT INTO sub (name_id, title, data_limit, date_limit, price, with_promo) 
-- VALUES ('personal', 'Персональный', 100, 2592000, 200, 1);

-- -- Вставка подписки "Free Trial"
-- INSERT INTO sub (name_id, title, data_limit, date_limit, price, with_promo) 
-- VALUES ('family', 'Семейный', 300, 2592000, 300, 1);

-- -- Вставка подписки "Basic"
-- INSERT INTO sub (name_id, title, data_limit, date_limit, price, with_promo) 
-- VALUES ('basic', 'Безлимит', 0, 2592000 , 500, 1);

-- Вставка подписки "Basic"
-- INSERT INTO sub (name_id, title, data_limit, date_limit, price, with_promo) 
-- VALUES ('basic', 'Безлимит', 0, 2592000 , 300, 1);

INSERT INTO sub (name_id, title, data_limit, date_limit, price, with_promo) 
VALUES ('person', 'Личный', 100, 2592000 , 150, 1);

INSERT INTO sub (name_id, title, data_limit, date_limit, price, with_promo) 
VALUES ('biglim', 'Личный', 200, 2592000 , 250, 1);

--- промокоды ---

-- Вставка промокода default
INSERT INTO promo (name_id, title, discount) 
VALUES ('default', '#БезПромокода', 0);

-- -- Вставка промокода ytube
-- INSERT INTO promo (name_id, title, discount) 
-- VALUES ('ytube', '#НезамедлительноЮтюб', 5);

-- -- Вставка промокода &9%D0T
-- INSERT INTO promo (name_id, title, discount) 
-- VALUES ('0942hmR3', '#КакПоРефералке', 50);

-- -- Вставка промокода &9%D0T
-- INSERT INTO promo (name_id, title, discount) 
-- VALUES ('&9%D0T', '#ЗнаюРазработчика', 50);
