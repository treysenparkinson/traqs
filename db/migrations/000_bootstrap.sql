-- 000: extensions and the conventions every later migration relies on.
--
-- citext: case-insensitive emails (membership compares lowercased emails today).

create extension if not exists citext;
