ALTER TABLE `exercises` ADD `is_public` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
-- Решение владельца: упражнения и программы по умолчанию общие; существующие программы становятся общими (в каталоге без личного состояния цикла)
UPDATE `programs` SET `is_public` = 1;