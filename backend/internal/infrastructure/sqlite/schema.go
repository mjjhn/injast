package sqlite

const schema = `
CREATE TABLE IF NOT EXISTS wallet (id INTEGER PRIMARY KEY CHECK(id=1), available INTEGER NOT NULL CHECK(available>=0));
CREATE TABLE IF NOT EXISTS goals (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, target INTEGER NOT NULL CHECK(target BETWEEN 500000 AND 200000000),
 saved INTEGER NOT NULL CHECK(saved>=0 AND saved<=target), deadline TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('wallet','monthly')), status TEXT NOT NULL CHECK(status IN ('active','completed')),
 created_at TEXT NOT NULL, CHECK((status='completed' AND saved=target) OR (status='active' AND saved<target))
);
CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY, goal_id TEXT NOT NULL, amount INTEGER NOT NULL, response BLOB NOT NULL);
`
